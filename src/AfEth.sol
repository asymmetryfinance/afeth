// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {IAfEth} from "./interfaces/afeth/IAfEth.sol";
import {Ownable} from "solady/src/auth/Ownable.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";
import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {SafeCastLib} from "solady/src/utils/SafeCastLib.sol";
import {IVotiumStrategy} from "./interfaces/afeth/IVotiumStrategy.sol";
import {SfrxEthStrategy} from "./strategies/SfrxEthStrategy.sol";

/// @dev AfEth is the strategy manager for the sfrxETH and votium strategies
contract AfEth is IAfEth, Ownable, ERC20Upgradeable {
    using FixedPointMathLib for uint256;
    using SafeTransferLib for address;
    using SafeCastLib for uint256;

    uint256 internal constant UNLOCK_REWARDS_OVER = 2 weeks;
    uint256 internal constant ONE_BPS = 10000;

    IVotiumStrategy public immutable VOTIUM;

    address public rewarder;
    uint16 public protocolFeeBps;
    uint16 public sfrxStrategyShareBps;

    uint128 internal lastLockedRewards;
    uint32 internal lastUpdatedLocked;
    bool public paused;

    /// @dev Maximum amount that can be staked in a single quick stake. Can be bypassed via multiple
    /// quick stakes, mainly to protect owner from large stakes that would gain on slippage.
    uint128 public maxSingleQuickDeposit;
    uint16 public quickDepositFeeBps;
    /// @dev Maximum amount that can be unstaked in a single quick unstake. Similar
    uint128 public maxSingleQuickWithdraw;
    uint16 public quickWithdrawFeeBps;

    receive() external payable {}

    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(address votiumAddress) {
        _disableInitializers();
        VOTIUM = IVotiumStrategy(payable(votiumAddress));
    }

    /**
     * @notice Initialize values for the contracts
     * @dev This replaces the constructor for upgradeable contracts
     */
    function initialize(address initialOwner, address initialRewarder) external initializer {
        __ERC20_init("Asymmetry Finance AfEth", "afETH");
        _initializeOwner(initialOwner);
        rewarder = initialRewarder;

        // SfrxEthStrategy is library, needs to be initialized as part of afETH.
        SfrxEthStrategy.init();

        // Configure default ratio to of sfrxETH to locked CVX to 70/30.
        sfrxStrategyShareBps = 0.7e4;
    }

    modifier latestAt(uint256 deadline) {
        if (block.timestamp > deadline) revert StaleAction();
        _;
    }

    modifier whileNotPaused() {
        if (paused) revert Paused();
        _;
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
        paused = true;
        VOTIUM.emergencyShutdown();
        emit EmergencyShutdown();
    }

    /**
     * @notice Deposits into each strategy
     * @dev This is the entry into the protocol
     * @param minDepositValue Minimum ETH value of deposit (in sfrxETH & CVX), defacto slippage.
     * @param deadline Sets a deadline for the deposit
     * @return amount afETH shares minted.
     */
    function deposit(uint256 minDepositValue, uint256 deadline)
        external
        payable
        whileNotPaused
        latestAt(deadline)
        returns (uint256 amount)
    {
        // Assumes that the price sources doesn't change atomically based on on-chain conditions
        // e.g. a chainlink price oracle. Determine value *before* actual deposit to avoid
        // miscalculating deposit shares.
        (uint256 sfrxStrategyValue, uint256 ethSfrxPrice) = SfrxEthStrategy.totalEthValue();
        (uint256 votiumValue, uint256 cvxEthPrice) = VOTIUM.totalEthValue();
        (, uint256 unlockedRewards) = _unlockedRewards();
        uint256 totalValue = sfrxStrategyValue + votiumValue + unlockedRewards;

        uint256 sfrxDepositValue = mulBps(msg.value, sfrxStrategyShareBps);
        uint256 mintedSfrxEth = SfrxEthStrategy.deposit(sfrxDepositValue);

        uint256 votiumDepositValue = msg.value - sfrxDepositValue;
        uint256 mintedCvx = VOTIUM.deposit{value: votiumDepositValue}();

        // Calculate the user's deposit value, makes system slippage agnostic (depositor responsible
        // for slippage based on their set `minOut`).
        uint256 depositValue = mintedSfrxEth.mulWad(ethSfrxPrice) + mintedCvx.mulWad(cvxEthPrice);
        if (depositValue < minDepositValue) revert BelowMinOut();

        uint256 supply = totalSupply();
        amount = supply == 0 ? depositValue : depositValue * supply / totalValue;
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
        latestAt(deadline)
        returns (bool locked, uint256 cumulativeUnlockThreshold)
    {
        uint256 withdrawShare = amount.divWad(totalSupply());
        _burn(msg.sender, amount);

        uint256 sfrxEthOut = SfrxEthStrategy.withdraw(withdrawShare);
        uint256 totalEthOut;
        (locked, totalEthOut, cumulativeUnlockThreshold) = VOTIUM.requestWithdraw(withdrawShare, msg.sender);
        totalEthOut += sfrxEthOut;
        uint256 minOut = locked ? minOutOnlySfrx : minOutAll;

        if (totalEthOut < minOut) revert BelowMinOut();
        if (totalEthOut > 0) msg.sender.safeTransferETH(totalEthOut);

        if (locked) emit PartialWithdraw(msg.sender, totalEthOut, cumulativeUnlockThreshold);
        else emit FullWithdraw(msg.sender, totalEthOut);
    }

    /**
     * @notice Allows rewarder to deposit external rewards and process unlocked rewards. Rebalances
     * by routing value to underweight strategy.
     */
    function depositRewardsAndRebalance(IAfEth.RebalanceParams calldata params)
        public
        payable
        whileNotPaused
        latestAt(params.deadline)
    {
        if (msg.sender != address(VOTIUM) && msg.sender != rewarder && msg.sender != owner()) {
            revert NotAuthorizedToRebalance();
        }

        (uint256 sfrxStrategyValue,) = SfrxEthStrategy.totalEthValue();
        (uint256 votiumValue,) = VOTIUM.totalEthValue();

        (uint256 lastLocked, uint256 unlockedRewards) = _unlockedRewards();
        // Fee accrues implicitly via the accounting (any ETH balance not locked is considered to be a "fee").
        uint256 fee = mulBps(msg.value, protocolFeeBps);

        _lockRewards(lastLocked - unlockedRewards + msg.value - fee);

        uint256 totalValue = sfrxStrategyValue + votiumValue + unlockedRewards;

        uint256 targetSfrxValue = mulBps(totalValue, sfrxStrategyShareBps);

        uint256 sfrxDepositAmountEth = 0;
        uint256 votiumDepositAmountEth = 0;
        if (sfrxStrategyValue > targetSfrxValue) {
            uint256 valueDelta;
            unchecked {
                valueDelta = sfrxStrategyValue - targetSfrxValue;
            }
            (uint256 ethReceived, uint256 sfrxEthRedeemed) = SfrxEthStrategy.withdrawEth(valueDelta);
            if (ethReceived.divWad(sfrxEthRedeemed) < params.ethPerSfrxMin) revert BelowMinOut();
            votiumDepositAmountEth = unlockedRewards + ethReceived;
        } else {
            uint256 targetVotiumValue = totalValue - targetSfrxValue;
            if (targetVotiumValue > votiumValue) {
                unchecked {
                    sfrxDepositAmountEth = targetSfrxValue - sfrxStrategyValue;
                    votiumDepositAmountEth = targetVotiumValue - votiumValue;
                }
            } else {
                sfrxDepositAmountEth = unlockedRewards;
            }
        }

        if (sfrxDepositAmountEth > 0) {
            uint256 sfrxOut = SfrxEthStrategy.deposit(sfrxDepositAmountEth);
            if (sfrxOut.divWad(sfrxDepositAmountEth) < params.sfrxPerEthMin) revert BelowMinOut();
        }
        if (votiumDepositAmountEth > 0) {
            VOTIUM.deposit{value: votiumDepositAmountEth}(
                votiumDepositAmountEth, votiumDepositAmountEth.mulWad(params.cvxPerEthMin)
            );
        }
    }

    function depositForQuickActions(uint256 afEthAmount) external payable onlyOwner {
        _transfer(msg.sender, address(this), afEthAmount == 0 ? balanceOf(msg.sender) : afEthAmount);
    }

    function withdrawOwnerFunds(uint256 afEthAmount, uint256 ethAmount) external onlyOwner {
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
        uint16 depositFeeBps,
        uint16 withdrawFeeBps,
        uint128 maxQuickDeposit,
        uint128 maxQuickWithdraw
    ) external onlyOwner {
        if (depositFeeBps >= ONE_BPS) revert InvalidFee();
        if (withdrawFeeBps >= ONE_BPS) revert InvalidFee();
        quickDepositFeeBps = depositFeeBps;
        maxSingleQuickDeposit = maxQuickDeposit;
        quickWithdrawFeeBps = withdrawFeeBps;
        maxSingleQuickWithdraw = maxQuickWithdraw;
        emit QuickActionsConfigured(depositFeeBps, withdrawFeeBps, maxQuickDeposit, maxQuickWithdraw);
    }

    function quickDeposit(uint256 minOut, uint256 deadline) public payable override returns (uint256 afEthOut) {
        afEthOut = quickDeposit(msg.sender, minOut, deadline);
    }

    function quickDeposit(address to, uint256 minOut, uint256 deadline)
        public
        payable
        override
        whileNotPaused
        latestAt(deadline)
        returns (uint256 afEthOut)
    {
        if (msg.value > maxSingleQuickDeposit) revert AboveActionMax();
        afEthOut = mulBps(minOut.divWad(price()), quickDepositFeeBps);
        if (afEthOut < minOut) revert BelowMinOut();
        _transfer(address(this), to, afEthOut);
    }

    function quickWithdraw(uint256 amount, uint256 minOut, uint256 deadline) public override returns (uint256 ethOut) {
        ethOut = quickWithdraw(msg.sender, amount, minOut, deadline);
    }

    function quickWithdraw(address to, uint256 amount, uint256 minOut, uint256 deadline)
        public
        override
        whileNotPaused
        latestAt(deadline)
        returns (uint256 ethOut)
    {
        if (amount > maxSingleQuickWithdraw) revert AboveActionMax();
        _transfer(msg.sender, address(this), amount);
        ethOut = mulBps(minOut.mulWad(price()), quickWithdrawFeeBps);
        if (ethOut < minOut) revert BelowMinOut();
        if (ethOut > ethOwedToOwner()) revert WithdrawingLockedRewards();
        to.safeTransferETH(amount);
    }

    /**
     * @notice Get's the price of afEth
     * @dev Checks each strategy and calculates the total value in ETH divided by supply of afETH tokens
     * @return Price of afEth
     */
    function price() public view returns (uint256) {
        uint256 totalSupply_ = totalSupply();
        if (totalSupply_ == 0) return 1e18;

        return totalEthValue().divWad(totalSupply_);
    }

    function ethOwedToOwner() public view returns (uint256) {
        return address(this).balance - uint256(lastLockedRewards);
    }

    function reportValue()
        external
        view
        returns (
            uint256 activeSfrxRatio,
            uint256 sfrxStrategyValue,
            uint256 votiumValue,
            uint256 unlockedInactiveRewards,
            uint256 lockedRewards
        )
    {
        (sfrxStrategyValue,) = SfrxEthStrategy.totalEthValue();
        (votiumValue,) = VOTIUM.totalEthValue();
        uint256 totalActiveValue = sfrxStrategyValue + votiumValue;
        activeSfrxRatio = sfrxStrategyValue.divWad(totalActiveValue);
        uint256 lastLocked;
        (lastLocked, unlockedInactiveRewards) = _unlockedRewards();
        lockedRewards = lastLocked - unlockedInactiveRewards;
    }

    function totalEthValue() public view returns (uint256) {
        (uint256 sfrxStrategyValue,) = SfrxEthStrategy.totalEthValue();
        (uint256 votiumValue,) = VOTIUM.totalEthValue();
        (, uint256 unlockedRewards) = _unlockedRewards();
        return sfrxStrategyValue + votiumValue + unlockedRewards;
    }

    function _unlockedRewards() internal view returns (uint256 lastLocked, uint256 unlocked) {
        // Purposefully truncate time delta so that the time calculations will continue working
        // beyond 2106 years (end of 32-bit unix time) as long as you update the contract once every
        // ~136 years. (Not a requirement but nice to have).
        uint256 timeElapsed = uint32(block.timestamp - uint256(lastUpdatedLocked));

        lastLocked = lastLockedRewards;
        if (timeElapsed >= UNLOCK_REWARDS_OVER) unlocked = lastLocked;
        else unlocked = lastLocked * timeElapsed / UNLOCK_REWARDS_OVER;
    }

    function _lockRewards(uint256 newLockedRewards) internal {
        lastLockedRewards = newLockedRewards.toUint128();
        lastUpdatedLocked = uint32(block.timestamp);
    }

    function mulBps(uint256 value, uint256 bps) internal pure returns (uint256) {
        return value * bps / ONE_BPS;
    }
}
