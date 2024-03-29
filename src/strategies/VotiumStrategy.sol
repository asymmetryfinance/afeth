// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Ownable} from "solady/src/auth/Ownable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {TrackedAllowances, Allowance} from "../utils/TrackedAllowances.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {CvxEthOracleLib} from "../utils/CvxEthOracleLib.sol";
import {SafeCastLib} from "solady/src/utils/SafeCastLib.sol";
import {HashLib} from "../utils/HashLib.sol";
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
contract VotiumStrategy is IVotiumStrategy, Ownable, TrackedAllowances, UUPSUpgradeable {
    using FixedPointMathLib for uint256;
    using SafeTransferLib for address;
    using SafeCastLib for uint256;
    using HashLib for string;

    address public constant SNAPSHOT_DELEGATE_REGISTRY = 0x469788fE6E9E9681C6ebF3bF78e7Fd26Fc015446;
    bytes32 internal constant VOTE_DELEGATION_ID = "cvx.eth";
    address internal constant VOTE_PROXY = 0xde1E6A7ED0ad3F61D531a8a78E83CcDdbd6E0c49;

    bytes32 internal immutable LCVX_NO_EXP_LOCKS_ERROR_HASH = keccak256("no exp locks");
    bytes32 internal immutable LCVX_SHUTDOWN_ERROR_HASH = keccak256("shutdown");

    struct Swap {
        address target;
        bytes callData;
    }

    address public immutable manager;

    address public rewarder;

    /// @dev Tracks the total amount of CVX unlock obligations the contract has ever had.
    uint128 internal cumulativeCvxUnlockObligations;
    /// @dev Tracks the total amount of CVX that has ever been unlocked.
    uint128 internal cumulativeCvxUnlocked;

    uint256 public unprocessedRewards;

    mapping(address => mapping(uint256 => uint256)) public withdrawableAfterUnlocked;

    receive() external payable {}

    modifier onlyRewarder() {
        if (msg.sender != rewarder) revert Unauthorized();
        _;
    }

    modifier onlyManager() {
        if (msg.sender != manager) revert Unauthorized();
        _;
    }

    modifier notShutdown() {
        if (rewarder == address(0)) revert Shutdown();
        _;
    }

    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address afEth) {
        _disableInitializers();
        manager = afEth;
    }

    /**
     * @notice - Function to initialize values for the contracts
     * @dev - This replaces-  the constructor for upgradeable contracts
     * @param initialOwner Address of the owner of the contract (asym multisig)
     * @param initialRewarder Address of the rewarder contract (reward oracle)
     */
    function initialize(address initialOwner, address initialRewarder) external initializer {
        ISnapshotDelegationRegistry(SNAPSHOT_DELEGATE_REGISTRY).setDelegate(VOTE_DELEGATION_ID, VOTE_PROXY);
        rewarder = initialRewarder;
        _initializeOwner(initialOwner);
        __UUPSUpgradeable_init();

        // Approve once to save gas later by avoiding having to re-approve every time.
        _grantAndTrackInfiniteAllowance(Allowance({spender: address(LOCKED_CVX), token: CVX}));
        _grantAndTrackInfiniteAllowance(Allowance({spender: address(CVX_ETH_POOL), token: CVX}));

        emit RewarderSet(initialRewarder);
    }

    /**
     * @dev Allows the owner of the contract to upgrade to *any* new address.
     */
    function _authorizeUpgrade(address /* newImplementation */ ) internal view override onlyOwner {}

    /**
     * @notice - Function to set the address of the rewarder account that periodically claims rewards
     * @param newRewarder Address of the rewarder account
     */
    function setRewarder(address newRewarder) external onlyOwner {
        rewarder = newRewarder;
        emit RewarderSet(newRewarder);
    }

    /**
     * @dev Call in emergencies incase you need to stop all calls and transfers until further notice
     */
    function emergencyShutdown() external {
        if (!(msg.sender == owner() || msg.sender == manager)) revert Unauthorized();
        rewarder = address(0);
        _emergencyRevokeAllAllowances();
        emit RewarderSet(address(0));
        emit EmergencyShutdown();
    }

    /**
     * @dev Using this function on its own is **unsafe** as it does not set a minimum out. Only use
     * in conjunction with some price checking mechanism.
     * @notice Deposit eth to mint this token at current price
     * @return cvxAmount Amount of CVX bought
     */
    function deposit() external payable returns (uint256 cvxAmount) {
        cvxAmount = deposit(0);
    }

    /**
     * @notice Sells amount of ETH from votium contract for CVX.
     * @param cvxMinOut Minimum amount of CVX to receive
     */
    function deposit(uint256 cvxMinOut) public payable onlyManager returns (uint256 cvxAmount) {
        cvxAmount = unsafeBuyCvx(msg.value);
        if (cvxAmount < cvxMinOut) revert ExchangeOutputBelowMin();
        (,, uint256 totalUnlockObligations) = getObligations();
        if (cvxAmount >= totalUnlockObligations) {
            _processExpiredLocks(true);
            unchecked {
                uint256 lockAmount = cvxAmount - totalUnlockObligations;
                if (lockAmount > 0) _lock(lockAmount);
            }
        } else {
            uint256 unlocked = _unlockAvailable();
            if (unlocked > totalUnlockObligations) {
                unchecked {
                    _lock(unlocked - totalUnlockObligations);
                }
            }
        }
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

        (, uint256 cumCvxUnlockObligations, uint256 totalUnlockObligations) = getObligations();

        uint256 unlockedCvx = _unlockAvailable();
        uint256 lockedCvx = _lockedBalance();

        uint256 netCvx = lockedCvx + unlockedCvx - totalUnlockObligations;
        uint256 cvxAmount = netCvx.mulWad(share);
        totalUnlockObligations += cvxAmount;

        if (unlockedCvx >= totalUnlockObligations) {
            ethOutNow = unsafeSellCvx(cvxAmount);
            unchecked {
                uint256 lockAmount = unlockedCvx - totalUnlockObligations;
                if (lockAmount > 0) _lock(lockAmount);
            }
        } else {
            locked = true;
            cumulativeUnlockThreshold = uint128(cumCvxUnlockObligations) + cvxAmount.toUint128();
            // Have to increment in case `cvxAmount` right after another request.
            withdrawableAfterUnlocked[to][cumulativeUnlockThreshold] += cvxAmount;
            cumulativeCvxUnlockObligations = uint128(cumulativeUnlockThreshold);
        }

        if (ethOutNow > 0) msg.sender.safeTransferETH(ethOutNow);
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
        notShutdown
        returns (uint256 ethReceived)
    {
        if (block.timestamp > deadline) revert StaleAction();

        uint256 cvxAmount = withdrawableAfterUnlocked[msg.sender][cumulativeUnlockThreshold];
        if (cvxAmount == 0) return ethReceived;

        (uint256 cumCvxUnlocked,, uint256 totalUnlockObligations) = getObligations();

        uint256 unlockedCvx = _unlockAvailable();
        // Check if unlock threshold has already been reached, otherwise ensure there's sufficient
        // liquid CVX to cover the delta.
        if (cumulativeUnlockThreshold > cumCvxUnlocked) {
            unchecked {
                uint256 minUnlock = cumulativeUnlockThreshold - cumCvxUnlocked;
                if (unlockedCvx < minUnlock) revert WithdrawalStillLocked();
            }
        }

        delete withdrawableAfterUnlocked[msg.sender][cumulativeUnlockThreshold];
        cumulativeCvxUnlocked = uint128(cumCvxUnlocked) + cvxAmount.toUint128();

        if (unlockedCvx > totalUnlockObligations) {
            unchecked {
                _lock(unlockedCvx - totalUnlockObligations);
            }
        }

        if (minOut == 0) {
            CVX.safeTransfer(msg.sender, cvxAmount);
        } else {
            ethReceived = unsafeSellCvx(cvxAmount);
            if (ethReceived < minOut) revert ExchangeOutputBelowMin();

            if (ethReceived > 0) msg.sender.safeTransferETH(ethReceived);
        }
    }

    /**
     * @notice Relock on behalf of entire lock.
     * @dev Needs to be called every few weeks if regular deposits / withdrawals aren't
     * happening to prevent receiving losses from kick penalties.
     */
    function processAndRelock() external {
        (,, uint256 totalUnlockObligations) = getObligations();
        uint256 unlockedCvx = _unlockAvailable();
        if (unlockedCvx > totalUnlockObligations) {
            unchecked {
                _lock(unlockedCvx - totalUnlockObligations);
            }
        }
    }

    /**
     * @notice Allow rewarder oracle account to claim rewards
     * @param claimProofs - Array of claim proofs
     */
    function claimRewards(IVotiumMerkleStash.ClaimParam[] calldata claimProofs) external onlyRewarder {
        uint256 cvxBalanceBefore = CVX.balanceOf(address(this));
        try VOTIUM_MERKLE_STASH.claimMulti(address(this), claimProofs) {} catch {}
        address[] memory emptyArray;
        try ZAP_CLAIM.claimRewards(emptyArray, emptyArray, emptyArray, emptyArray, 0, 0, 0, 0, 8) {} catch {}
        // Assumes neither claim function can reenter, reentrancy would allow for double-counting
        // rewards and allow the rewarder to drain any unlocked CVX.
        uint256 newRewards = CVX.balanceOf(address(this)) - cvxBalanceBefore;

        if (newRewards > 0) {
            unprocessedRewards += newRewards;
            // CVX is already liquid, just ensures that withdraw/deposit don't use the reward amount so
            // it's already available for swapping.
            cumulativeCvxUnlockObligations += newRewards.toUint128();
        }
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
     * @param cvxPerEthMin Minimum accepted ETH/CVX price when converting ETH to CVX.
     * @param sfrxPerEthMin Minimum accepted ETH/sfrxETH price when converting ETH to sfrxETH.
     * @param ethPerSfrxMin Maximum accepted ETH/sfrxETH price when converting sfrxETH to ETH.
     * @param deadline Minimum amount of cvx to mint from rewards
     */
    function swapRewards(
        Swap[] calldata swaps,
        uint256 cvxPerEthMin,
        uint256 sfrxPerEthMin,
        uint256 ethPerSfrxMin,
        uint256 deadline
    ) external onlyRewarder {
        if (block.timestamp > deadline) revert StaleAction();

        address manager_ = manager;

        uint256 cvxBalanceBefore = CVX.balanceOf(address(this));

        uint256 totalSwaps = swaps.length;
        for (uint256 i = 0; i < totalSwaps; i++) {
            Swap calldata swap = swaps[i];
            address target = swap.target;
            _checkTargetAuthorized(manager_, target);
            (bool success,) = target.call(swap.callData);
            if (!success) emit FailedToSell(i);
        }

        // Ensure CVX isn't indirectly stolen via approved addresses.
        uint256 cvxBalanceAfter = CVX.balanceOf(address(this));
        if (cvxBalanceBefore > cvxBalanceAfter) {
            uint256 cvxSwapped;
            unchecked {
                cvxSwapped = cvxBalanceBefore - cvxBalanceAfter;
            }
            // Implicit underflow check ensures only rewards are spent.
            unprocessedRewards -= cvxSwapped;
            cumulativeCvxUnlocked += cvxSwapped.toUint128();
        }

        IAfEth(manager_).depositRewardsAndRebalance{value: address(this).balance}(
            IAfEth.RebalanceParams({
                cvxPerEthMin: cvxPerEthMin,
                sfrxPerEthMin: sfrxPerEthMin,
                ethPerSfrxMin: ethPerSfrxMin,
                deadline: block.timestamp
            })
        );
    }

    /**
     * @notice The amount of CVX in the entire system
     * @return Amount of CVX in the entire system
     */
    function availableCvx() public view returns (uint256) {
        (,, uint256 totalUnlockObligations) = getObligations();
        uint256 lockedCvx = _lockedBalance();
        uint256 unlockedCvx = CVX.balanceOf(address(this));
        return lockedCvx + unlockedCvx - totalUnlockObligations;
    }

    function totalEthValue() external view returns (uint256 value, uint256 price) {
        price = CvxEthOracleLib.ethCvxPrice();
        value = availableCvx().mulWad(price);
    }

    function getObligations()
        public
        view
        returns (uint256 cumCvxUnlocked, uint256 cumCvxUnlockObligations, uint256 totalUnlockObligations)
    {
        cumCvxUnlocked = cumulativeCvxUnlocked;
        cumCvxUnlockObligations = cumulativeCvxUnlockObligations;
        totalUnlockObligations = cumCvxUnlockObligations - cumCvxUnlocked;
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

    function _unlockAvailable() internal returns (uint256 totalUnlocked) {
        _processExpiredLocks(false);
        totalUnlocked = CVX.balanceOf(address(this));
    }

    function _lock(uint256 amount) internal {
        try LOCKED_CVX.lock(address(this), amount, 0) {}
        catch Error(string memory err) {
            if (err.hash() != LCVX_SHUTDOWN_ERROR_HASH) revert UnexpectedLockedCvxError();
        }
    }

    function _lockedBalance() internal view returns (uint256) {
        return LOCKED_CVX.lockedBalanceOf(address(this));
    }

    function _processExpiredLocks(bool relock) internal {
        if (_lockedBalance() > 0) {
            try LOCKED_CVX.processExpiredLocks({relock: relock}) {}
            catch Error(string memory err) {
                if (err.hash() != LCVX_NO_EXP_LOCKS_ERROR_HASH) revert UnexpectedLockedCvxError();
            }
        }
    }

    function _checkTargetAuthorized(address manager_, address target) internal view {
        // Ensure compromised rewarder can't directly steal CVX.
        if (target == manager_ || target == address(LOCKED_CVX) || target == address(CVX) || target == address(this)) {
            revert UnauthorizedTarget();
        }
    }
}
