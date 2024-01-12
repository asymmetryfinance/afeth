// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {TrackedAllowances, Allowance} from "../utils/TrackedAllowances.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {CvxEthOracleLib} from "../utils/CvxEthOracleLib.sol";
import {SafeCastLib} from "solady/src/utils/SafeCastLib.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ILockedCvx, LOCKED_CVX} from "../interfaces/curve-convex/ILockedCvx.sol";
import {IVotiumStrategy} from "../interfaces/afeth/IVotiumStrategy.sol";
import {IVotiumMerkleStash, VOTIUM_MERKLE_STASH} from "../interfaces/curve-convex/IVotiumMerkleStash.sol";
import {ISnapshotDelegationRegistry} from "../interfaces/curve-convex/ISnapshotDelegationRegistry.sol";
import {CVX_ETH_POOL, ETH_COIN_INDEX, CVX_COIN_INDEX} from "../interfaces/curve-convex/ICvxEthPool.sol";
import {LOCKED_CVX} from "../interfaces/curve-convex/ILockedCvx.sol";
import {ZAP_CLAIM} from "../interfaces/IClaimZap.sol";
import {CVX} from "../interfaces/curve-convex/Constants.sol";
import {IAfEth} from "../interfaces/afeth/IAfEth.sol";

/// @title Votium Strategy Token
/// @author Asymmetry Finance
contract VotiumStrategy is IVotiumStrategy, Ownable, TrackedAllowances, Initializable {
    using FixedPointMathLib for uint256;
    using SafeTransferLib for address;

    using SafeCastLib for uint256;

    address public constant SNAPSHOT_DELEGATE_REGISTRY = 0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446;
    bytes32 internal constant VOTE_DELEGATION_ID = 0x6376782e65746800000000000000000000000000000000000000000000000000;
    address internal constant VOTE_PROXY = 0xde1E6A7ED0ad3F61D531a8a78E83CcDdbd6E0c49;

    /// @dev How the minimum out threshold is set relative to
    uint256 internal constant MIN_OUT_SHARE = 0.97e18;

    struct Swap {
        address swapTarget;
        bytes swapCallData;
    }

    address public rewarder;
    address public manager;

    uint128 public cumulativeCvxUnlockObligations;
    uint128 public cumulativeCvxUnlocked;

    mapping(address => mapping(uint256 => uint256)) public withdrawableAfterUnlocked;

    // used to add storage variables in the future
    uint256[18] private __gap;

    receive() external payable {}

    modifier onlyRewarder() {
        if (msg.sender != rewarder) revert Unauthorized();
        _;
    }

    modifier onlyManager() {
        if (msg.sender != manager) revert Unauthorized();
        _;
    }

    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice - Function to initialize values for the contracts
     * @dev - This replaces the constructor for upgradeable contracts
     * @param _owner Address of the owner of the contract (asym multisig)
     * @param _rewarder Address of the rewarder contract (reward oracle)
     * @param _manager Address of the manager contract (afEth)
     */
    function initialize(address _owner, address _rewarder, address _manager) external initializer {
        ISnapshotDelegationRegistry(SNAPSHOT_DELEGATE_REGISTRY).setDelegate(VOTE_DELEGATION_ID, VOTE_PROXY);
        rewarder = _rewarder;
        manager = _manager;
        _initializeOwner(_owner);

        // Approve once to save gas later by avoiding having to re-approve every time.
        _grantAndTrackInfiniteAllowance(Allowance({spender: address(LOCKED_CVX), token: CVX}));
        _grantAndTrackInfiniteAllowance(Allowance({spender: address(CVX_ETH_POOL), token: CVX}));
    }

    /**
     * @notice - Function to set the address of the rewarder account that periodically claims rewards
     * @param _rewarder - Address of the rewarder account
     */
    function setRewarder(address _rewarder) external onlyOwner {
        rewarder = _rewarder;
        emit RewarderSet(_rewarder);
    }

    /**
     * @dev Call in emergencies incase you need to stop all calls and transfers until further notice
     */
    function emergencyShutdown() external {
        if (!(msg.sender == owner() || msg.sender == manager)) revert Unauthorized();
        manager = address(0);
        _emergencyRevokeAllAllowances();
        emit EmergencyShutdown();
    }

    /**
     * @dev Using this function on its own is **unsafe** as it does not set a minimum out. Only use
     * in conjunction with some price checking mechanism.
     * @notice Deposit eth to mint this token at current price
     * @return cvxAmount Amount of CVX bought
     */
    function deposit() external payable onlyManager returns (uint256 cvxAmount) {
        cvxAmount = deposit(msg.value, 0);
    }

    /**
     * @notice Sells amount of ETH from votium contract for CVX.
     * @param amount Amount of ETH to sell for CVX
     * @param cvxMinOut Minimum amount of CVX to receive
     */
    function deposit(uint256 amount, uint256 cvxMinOut) public payable onlyManager returns (uint256 cvxAmount) {
        cvxAmount = unsafeBuyCvx(amount);
        if (cvxAmount < cvxMinOut) revert ExchangeOutputBelowMin();
        LOCKED_CVX.lock(address(this), cvxAmount, 0);
    }

    /**
     * @notice Request to withdraw from strategy emits event with eligible withdraw epoch
     * @notice Burns afEth tokens and determines equivilent amount of cvx to start unlocking
     * @param share Share of total CVX to be withdrawn in WAD.
     * @return locked Whether the amount to withdraw is still locked.
     * @return ethOutNow The amount of ETH that was withdrawn now (0 if locked).
     * @return cumulativeUnlockThreshold The cumulative unlock amount at which the amount will be
     * withdrawable.
     */
    function requestWithdraw(uint256 share, address to)
        external
        onlyManager
        returns (bool locked, uint256 ethOutNow, uint256 cumulativeUnlockThreshold)
    {
        if (share == 0) return (false, 0, 0);

        (, uint256 cumCvxUnlockObligations, uint256 totalUnlockObligations) = _getObligations();

        uint256 unlockedCvx = _unlockAvailable();
        uint256 lockedCvx = LOCKED_CVX.lockedBalanceOf(address(this));

        uint256 availableCvx = lockedCvx + unlockedCvx - totalUnlockObligations;
        uint256 cvxAmount = availableCvx.mulWad(share);
        totalUnlockObligations += cvxAmount;

        if (unlockedCvx > totalUnlockObligations) {
            ethOutNow = unsafeSellCvx(cvxAmount);
            unchecked {
                _lock(unlockedCvx - totalUnlockObligations);
            }
        } else {
            locked = true;
            cumulativeUnlockThreshold = uint128(cumCvxUnlockObligations) + cvxAmount.toUint128();
            withdrawableAfterUnlocked[to][cumulativeUnlockThreshold] = cvxAmount;
            cumulativeCvxUnlockObligations = uint128(cumulativeUnlockThreshold);
            // TODO: Event
        }
    }

    /**
     * @notice Withdraws from requested withdraw if eligible epoch has passed
     * @param cumulativeUnlockThreshold The unlock amount threshold at which the CVX is meant to unlock.
     * @param minOut The minimum ETH to receive when swapping the CVX to withdraw to ETH. Will
     * transfer the CVX itself if set to 0.
     * @param deadline Timestamp after which the withdraw call should become invalid.
     */
    function withdrawLocked(uint256 cumulativeUnlockThreshold, uint256 minOut, uint256 deadline)
        external
        returns (uint256 ethReceived)
    {
        if (block.timestamp > deadline) revert StaleAction();

        uint256 cvxAmount = withdrawableAfterUnlocked[msg.sender][cumulativeUnlockThreshold];
        if (cvxAmount == 0) return ethReceived;

        (uint256 cumCvxUnlocked,, uint256 totalUnlockObligations) = _getObligations();

        uint256 unlockedCvx = _unlockAvailable();
        if (cumulativeUnlockThreshold > cumCvxUnlocked) {
            unchecked {
                uint256 minUnlock = cumulativeUnlockThreshold - cumCvxUnlocked;
                if (unlockedCvx < minUnlock) revert WithdrawalStillLocked();
            }
        }

        delete withdrawableAfterUnlocked[msg.sender][cumulativeUnlockThreshold];
        cumulativeCvxUnlocked = uint128(cumCvxUnlocked) + cvxAmount.toUint128();

        if (minOut == 0) {
            CVX.safeTransfer(msg.sender, cvxAmount);
        } else {
            ethReceived = unsafeSellCvx(cvxAmount);
            if (ethReceived < minOut) revert ExchangeOutputBelowMin();

            if (unlockedCvx > totalUnlockObligations) {
                unchecked {
                    _lock(unlockedCvx - totalUnlockObligations);
                }
            }
            if (ethReceived > 0) msg.sender.safeTransferETH(ethReceived);
        }
    }

    /**
     * @notice Allow rewarder oracle account to claim rewards
     * @param claimProofs - Array of claim proofs
     */
    function claimRewards(IVotiumMerkleStash.ClaimParam[] calldata claimProofs) external onlyRewarder {
        VOTIUM_MERKLE_STASH.claimMulti(address(this), claimProofs);
        address[] memory emptyArray;
        ZAP_CLAIM.claimRewards(emptyArray, emptyArray, emptyArray, emptyArray, 0, 0, 0, 0, 8);
    }

    /**
     * @dev Grant additional allowances required for the {applyRewards} function to actually be able
     * to execute various swaps on behalf of this contract. Allowance are tracked and can be revoked
     * all together via the {emergencyShutdown} function.
     */
    function grantAddedAllowances(Allowance[] calldata allowances) external onlyOwner {
        uint256 totalAllowances = allowances.length;
        for (uint256 i = 0; i < totalAllowances; i++) {
            _grantAndTrackInfiniteAllowance(allowances[i]);
        }
    }

    function revokeSingleAllowance(Allowance calldata allowance) external onlyOwner {
        _revokeSingleAllowance(allowance);
    }

    /**
     * @notice Function for rewarder to sell all claimed token rewards and buy & lock more cvx
     * @dev Causes price to go up
     * @param swaps Array of Swap structs for 0x swaps.
     * @param ethPerCvxMin Minimum accepted ETH/CVX price when converting ETH to CVX.
     * @param ethPerSfrxMin Minimum accepted ETH/sfrxETH price when converting ETH to sfrxETH.
     * @param ethPerSfrxMax Maximum accepted ETH/sfrxETH price when converting sfrxETH to ETH.
     * @param deadline Minimum amount of cvx to mint from rewards
     */
    function swapRewards(
        Swap[] calldata swaps,
        uint256 ethPerCvxMin,
        uint256 ethPerSfrxMin,
        uint256 ethPerSfrxMax,
        uint256 deadline
    ) external onlyRewarder {
        if (block.timestamp > deadline) revert StaleAction();

        uint256 totalSwaps = swaps.length;
        for (uint256 i = 0; i < totalSwaps; i++) {
            Swap calldata swap = swaps[i];
            (bool success,) = swap.swapTarget.call(swap.swapCallData);
            if (!success) {
                emit FailedToSell(i);
            }
        }

        IAfEth(manager).depositRewardsAndRebalance{value: address(this).balance}(
            ethPerCvxMin, ethPerSfrxMin, ethPerSfrxMax, block.timestamp
        );
    }

    /**
     * @notice The amount of cvx in the entire system
     * @return Amount of cvx in the entire system
     */
    function totalCvx() public view returns (uint256) {
        (,, uint256 totalUnlockObligations) = _getObligations();
        uint256 lockedCvx = LOCKED_CVX.lockedBalanceOf(address(this));
        uint256 unlockedCvx = CVX.balanceOf(address(this));
        return lockedCvx + unlockedCvx - totalUnlockObligations;
    }

    function totalEthValue() public view returns (uint256 value, uint256 price) {
        price = CvxEthOracleLib.ethCvxPrice();
        value = totalCvx().mulWad(price);
    }

    /**
     * @dev Swaps `ethAmountIn` ETH for CVX. Unsafe as it does not check min out, must be checked
     * by caller.
     * @param ethAmountIn Amount of ETH to spend
     * @return cvxAmountOut Amount of CVX bought
     */
    function unsafeBuyCvx(uint256 ethAmountIn) internal returns (uint256 cvxAmountOut) {
        cvxAmountOut =
            CVX_ETH_POOL.exchange_underlying{value: ethAmountIn}(ETH_COIN_INDEX, CVX_COIN_INDEX, ethAmountIn, 0);
    }

    /**
     * @dev Swaps `cvxAmountIn` CVX for ETH. Unsafe as it does not check min out, must be checked
     * by caller.
     * @param cvxAmountIn Amount of ETH to spend
     * @return ethAmountOut Amount of CVX bought
     */
    function unsafeSellCvx(uint256 cvxAmountIn) internal returns (uint256 ethAmountOut) {
        ethAmountOut = CVX_ETH_POOL.exchange_underlying(CVX_COIN_INDEX, ETH_COIN_INDEX, cvxAmountIn, 0);
    }

    function _getObligations()
        internal
        view
        returns (uint256 cumCvxUnlocked, uint256 cumCvxUnlockObligations, uint256 totalUnlockObligations)
    {
        cumCvxUnlocked = cumulativeCvxUnlocked;
        cumCvxUnlockObligations = cumulativeCvxUnlockObligations;
        totalUnlockObligations = cumCvxUnlockObligations - cumCvxUnlocked;
    }

    function _relock(uint256 unlockObligations) internal {
        if (unlockObligations == 0) {
            LOCKED_CVX.processExpiredLocks({relock: true});
        } else {
            LOCKED_CVX.processExpiredLocks({relock: false});
            uint256 unlockedCvx = CVX.balanceOf(address(this));
            if (unlockedCvx > unlockObligations) {
                unchecked {
                    uint256 amountToRelock = unlockedCvx - unlockObligations;
                    LOCKED_CVX.lock(address(this), amountToRelock, 0);
                }
            }
        }
    }

    function _unlockAvailable() internal returns (uint256 totalUnlocked) {
        LOCKED_CVX.processExpiredLocks({relock: false});
        return CVX.balanceOf(address(this));
    }

    function _lock(uint256 amount) internal {
        LOCKED_CVX.lock(address(this), amount, 0);
    }
}
