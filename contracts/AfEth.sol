// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {IAfEth} from "./interfaces/afeth/IAfEth.sol";
import {Ownable} from "solady/src/auth/Ownable.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {SafeCastLib} from "solady/src/utils/SafeCastLib.sol";
import {IVotiumStrategy} from "./interfaces/afeth/IVotiumStrategy.sol";
import {SfrxEthStrategy} from "./strategies/SfrxEthStrategy.sol";
import {ERC1967, ERC1967_IMPL_SLOT} from "./utils/ERC1967.sol";
import {HotData} from "./utils/HotDataLib.sol";

/// @dev AfEth is the strategy manager for the sfrxETH and votium strategies
contract AfEth is IAfEth, Ownable, ERC20Upgradeable, ERC1967 {
    using FixedPointMathLib for uint256;
    using SafeTransferLib for address;
    using SafeCastLib for uint256;

    uint256 internal constant UNLOCK_REWARDS_OVER = 2 weeks;
    uint256 internal constant ONE_BPS = 10000;

    IVotiumStrategy public immutable VOTIUM;

    address public rewarder;
    uint16 public protocolFeeBps;
    uint16 public sfrxStrategyShareBps;

    /// @dev Maximum amount that can be staked in a single quick stake. Can be bypassed via multiple
    /// quick stakes, mainly to protect owner from large stakes that would gain on slippage.
    uint128 public maxSingleQuickStake;
    uint16 public quickStakeFeeBps;
    /// @dev Maximum amount that can be unstaked in a single quick unstake. Similar
    uint128 public maxSingleQuickUnstake;
    uint16 public quickUnstakeFeeBps;

    struct ERC1967Slot {
        address implementation;
        HotData hotData;
    }

    receive() external payable {}

    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address votiumAddress) {
        _disableInitializers();
        VOTIUM = IVotiumStrategy(payable(votiumAddress));
    }

    /**
     * @notice - Initialize values for the contracts
     * @dev - This replaces the constructor for upgradeable contracts
     */
    function initialize() external initializer {
        __ERC20_init("Asymmetry Finance AfEth", "afETH");
        _initializeOwner(msg.sender);

        // Configure default ratio to of sfrxETH to locked CVX to 70/30.
        sfrxStrategyShareBps = 0.7e4;
    }

    modifier whileNotPaused() {
        if (paused()) revert Paused();
        _;
    }

    /**
     * @dev Upgrades the underlying proxy to a new implementation according to the ERC1967 standard.
     */
    function upgradeTo(address newImplementation, bytes memory reinitializationData) external onlyOwner {
        _upgradeTo(newImplementation, reinitializationData);
    }

    /**
     * @notice - Sets the rewarder address
     * @param _rewarder - rewarder address
     */
    function setRewarder(address _rewarder) external onlyOwner {
        rewarder = _rewarder;
        emit SetRewarder(_rewarder);
    }

    /**
     * @notice Sets the share of value in WAD that the sfrxEth strategy should hold.
     * @notice Target ratio is maintained by directing rewards into either sfrxETH or votium strategy.
     * @param newShareBps New share of the sfrxETH strategy (votium's share is automatically 100% - sfrxStrategyShare)
     */
    function setSfrxEthStrategyShare(uint16 newShareBps) external onlyOwner {
        if (newShareBps > ONE_BPS) revert InvalidShare();
        sfrxStrategyShareBps = newShareBps;
        emit SetSfrxStrategyShare(newShareBps);
    }

    /**
     * @notice Sets the protocol fee which takes a percentage of the rewards.
     * @param newFeeBps New protocol fee
     */
    function setProtocolFee(uint16 newFeeBps) external onlyOwner {
        if (newFeeBps > ONE_BPS) revert InvalidFee();
        protocolFeeBps = newFeeBps;
        emit SetProtocolFee(newFeeBps);
    }

    function emergencyShutdown() external onlyOwner {
        ERC1967Slot storage slot = _erc1967Slot();
        slot.hotData = slot.hotData.setPaused(true);
        VOTIUM.emergencyShutdown();
        emit EmergencyShutdown();
    }

    /**
     * @notice Deposits into each strategy
     * @dev This is the entry into the protocol
     * @param minOut Minimum amount of afEth to mint
     * @param deadline Sets a deadline for the deposit
     * @return amount afETH shares minted.
     */
    function deposit(uint256 minOut, uint256 deadline) external payable whileNotPaused returns (uint256 amount) {
        if (block.timestamp > deadline) revert StaleAction();

        // Assumes that the price sources doesn't change atomically based on on-chain conditions
        // e.g. a chainlink price oracle.
        (uint256 sfrxStrategyValue, uint256 ethSfrxPrice) = SfrxEthStrategy.totalEthValue();
        (uint256 votiumValue, uint256 cvxEthPrice) = VOTIUM.totalEthValue();

        uint256 mintedSfrxEth = SfrxEthStrategy.deposit(sfrxStrategyValue);
        uint256 mintedCvx = VOTIUM.deposit{value: votiumValue}();

        (, uint256 unlockedRewards) = _unlockedRewards();
        uint256 totalValue = sfrxStrategyValue + votiumValue + unlockedRewards;
        // Calculate the user's deposit value, makes system slippage agnostic (depositor responsible
        // for slippage based on their set `minOut`).
        uint256 depositValue = mintedSfrxEth.mulWad(ethSfrxPrice) + mintedCvx.mulWad(cvxEthPrice);

        amount = depositValue * totalSupply() / totalValue;

        if (amount < minOut) revert BelowMinOut();
        _mint(msg.sender, amount);

        emit Deposit(msg.sender, amount, msg.value);
    }

    /**
     * @notice Request to close position
     * @param amount Amount of afEth to withdraw
     */
    function requestWithdraw(uint256 amount, uint256 minOutOnlySfrx, uint256 minOutAll, uint256 deadline)
        external
        whileNotPaused
        returns (bool locked, uint256 cumulativeUnlockThreshold)
    {
        if (block.timestamp > deadline) revert StaleAction();

        uint256 withdrawShare = amount.divWad(totalSupply());
        _burn(msg.sender, amount);

        uint sfrxEthOut = SfrxEthStrategy.withdraw(withdrawShare);
        uint256 totalEthOut;
        (locked, totalEthOut, cumulativeUnlockThreshold) = VOTIUM.requestWithdraw(withdrawShare, msg.sender);
        totalEthOut += sfrxEthOut
        uint256 minOut = locked ? minOutOnlySfrx : minOutAll;

        if (totalEthOut < minOut) revert BelowMinOut();
        if (totalEthOut > 0) msg.sender.safeTransferETH(totalEthOut);

        if (locked) emit PartialWithdraw(msg.sender, totalEthOut, cumulativeUnlockThreshold);
        else emit FullWithdraw(msg.sender, totalEthOut);
    }

    /**
     * @notice Allows rewarder to deposit external rewards and process unlocked rewards. Rebalances
     * by routing value to underweight strategy.
     * @param ethPerCvxMin Minimum accepted ETH/CVX price when converting ETH to CVX.
     * @param ethPerSfrxMin Minimum accepted ETH/sfrxETH price when converting ETH to sfrxETH.
     * @param ethPerSfrxMax Maximum accepted ETH/sfrxETH price when converting sfrxETH to ETH.
     * @param deadline Last timestamp at which this call will be valid.
     */
    function depositRewardsAndRebalance(
        uint256 ethPerCvxMin,
        uint256 ethPerSfrxMin,
        uint256 ethPerSfrxMax,
        uint256 deadline
    ) public payable whileNotPaused {
        if (msg.sender != address(VOTIUM) && msg.sender != rewarder) {
            revert NotAuthorizedToRebalance();
        }
        if (block.timestamp > deadline) revert StaleAction();

        (uint256 sfrxStrategyValue,) = SfrxEthStrategy.totalEthValue();
        (uint256 votiumValue,) = VOTIUM.totalEthValue();

        uint256 unlockedRewards;

        {
            uint256 lastLocked;
            (lastLocked, unlockedRewards) = _unlockedRewards();
            // Fee accrues implicitly via the accounting (any ETH balance not locked is considered to be a "fee").
            uint256 fee = mulBps(msg.value, protocolFeeBps);

            _lockRewards(lastLocked - unlockedRewards + msg.value - fee);
        }

        uint256 totalValue = sfrxStrategyValue + votiumValue + unlockedRewards;

        uint256 targetSfrxValue = mulBps(totalValue, sfrxStrategyShareBps);

        uint256 sfrxDepositAmount = 0;
        uint256 votiumDepositAmount = 0;
        if (sfrxStrategyValue > targetSfrxValue) {
            uint256 valueDelta;
            unchecked {
                valueDelta = sfrxStrategyValue - targetSfrxValue;
            }
            (uint256 ethReceived, uint256 sfrxEthRedeemed) = SfrxEthStrategy.withdrawEth(valueDelta);
            if (ethReceived.divWad(sfrxEthRedeemed) > ethPerSfrxMax) revert AboveMaxOut();
            votiumDepositAmount = unlockedRewards + ethReceived;
        } else {
            uint256 targetVotiumValue = totalValue - targetSfrxValue;
            if (targetVotiumValue > votiumValue) {
                unchecked {
                    sfrxDepositAmount = targetSfrxValue - sfrxStrategyValue;
                    votiumDepositAmount = targetVotiumValue - votiumValue;
                }
            } else {
                sfrxDepositAmount = unlockedRewards;
            }
        }

        if (sfrxDepositAmount > 0) {
            uint256 sfrxEthOut = SfrxEthStrategy.deposit(sfrxDepositAmount);
            if (sfrxDepositAmount.divWad(sfrxEthOut) < ethPerSfrxMin) revert BelowMinOut();
        }
        if (votiumDepositAmount > 0) {
            VOTIUM.deposit{value: votiumDepositAmount}(votiumDepositAmount, votiumDepositAmount.divWad(ethPerCvxMin));
        }
    }

    function depositForQuickActions(uint256 afEthAmount) external payable onlyOwner {
        _transfer(msg.sender, address(this), afEthAmount == 0 ? balanceOf(msg.sender) : afEthAmount);
    }

    function withdrawFromQuickActions(uint256 afEthAmount, uint256 ethAmount) external onlyOwner {
        _transfer(address(this), msg.sender, afEthAmount == 0 ? balanceOf(address(this)) : afEthAmount);
        uint256 maxEthAmount = ethOwedToOwner();
        if (ethAmount == 0) {
            ethAmount = maxEthAmount;
        } else if (ethAmount > maxEthAmount) {
            revert WithdrawingLockedRewards();
        }
        msg.sender.safeTransferETH(ethAmount);
    }

    function configureQuickActions(
        uint16 stakeFeeBps,
        uint16 unstakeFeeBps,
        uint128 maxQuickStake,
        uint128 maxQuickUnstake
    ) external onlyOwner {
        if (stakeFeeBps >= ONE_BPS) revert InvalidFee();
        if (unstakeFeeBps >= ONE_BPS) revert InvalidFee();
        quickStakeFeeBps = stakeFeeBps;
        maxSingleQuickStake = maxQuickStake;
        quickUnstakeFeeBps = unstakeFeeBps;
        maxSingleQuickUnstake = maxQuickUnstake;
        emit QuickActionsConfigured(stakeFeeBps, unstakeFeeBps, maxQuickStake, maxQuickUnstake);
    }

    function quickStake(uint256 minOut) external payable whileNotPaused {
        if (msg.value > maxSingleQuickStake) revert AboveActionMax();
        uint256 afEthOut = mulBps(minOut.divWad(price()), quickStakeFeeBps);
        if (afEthOut < minOut) revert BelowMinOut();
        _transfer(address(this), msg.sender, afEthOut);
    }

    function quickUnstake(uint256 amount, uint256 minOut) external whileNotPaused {
        _transfer(msg.sender, address(this), amount);
        if (amount > maxSingleQuickUnstake) revert AboveActionMax();
        uint256 ethOut = mulBps(minOut.mulWad(price()), quickUnstakeFeeBps);
        if (ethOut < minOut) revert BelowMinOut();
        if (ethOut > ethOwedToOwner()) revert WithdrawingLockedRewards();
        msg.sender.safeTransferETH(amount);
    }

    /**
     * @notice Get's the price of afEth
     * @dev Checks each strategy and calculates the total value in ETH divided by supply of afETH tokens
     * @return Price of afEth
     */
    function price() public view returns (uint256) {
        uint256 totalSupply_ = totalSupply();
        if (totalSupply_ == 0) return 1e18;

        return _totalEthValue().divWad(totalSupply_);
    }

    function paused() public view returns (bool) {
        return _erc1967Slot().hotData.paused();
    }

    function ethOwedToOwner() public view returns (uint256) {
        return address(this).balance - _erc1967Slot().hotData.getLastLockedRewards();
    }

    function _totalEthValue() internal view returns (uint256) {
        (uint256 sfrxStrategyValue,) = SfrxEthStrategy.totalEthValue();
        (uint256 votiumValue,) = VOTIUM.totalEthValue();
        (, uint256 unlockedRewards) = _unlockedRewards();
        return sfrxStrategyValue + votiumValue + unlockedRewards;
    }

    function _unlockedRewards() internal view returns (uint256 lastLocked, uint256 unlocked) {
        HotData data = _erc1967Slot().hotData;
        uint256 timeElapsed = block.timestamp - data.getLastUpdated();

        lastLocked = data.getLastLockedRewards();
        if (timeElapsed >= UNLOCK_REWARDS_OVER) unlocked = lastLocked;
        else unlocked = lastLocked * timeElapsed / UNLOCK_REWARDS_OVER;
    }

    function _lockRewards(uint256 newLockedRewards) internal {
        ERC1967Slot storage slot = _erc1967Slot();
        /// forgefmt: disable-next-item
        slot.hotData = slot.hotData
            .setLastLockedRewards(newLockedRewards)
            .setLastUpdated(block.timestamp);
    }

    function mulBps(uint256 value, uint256 bps) internal pure returns (uint256) {
        return value * bps / ONE_BPS;
    }

    function _erc1967Slot() internal pure returns (ERC1967Slot storage slot) {
        /// @solidity memory-safe-assembly
        assembly {
            slot.slot := ERC1967_IMPL_SLOT
        }
    }
}
