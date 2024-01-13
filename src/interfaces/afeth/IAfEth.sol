// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IAfEth {
    error StrategyAlreadyAdded();
    error InvalidFee();
    error Paused();
    error WithdrawingLockedRewards();
    error BelowMinOut();
    error AboveMaxOut();
    error StaleAction();
    error NotAuthorizedToRebalance();
    error InvalidShare();

    error AboveActionMax();

    event SetRewarder(address indexed newAddress);
    event SetSfrxStrategyShare(uint256 indexed newShare);
    event SetProtocolFee(uint256 indexed newProtocolFee);
    event EmergencyShutdown();
    event Deposit(address indexed recipient, uint256 afEthAmount, uint256 ethAmount);

    event FullWithdraw(address indexed recipient, uint256 ethAmount);
    event PartialWithdraw(address indexed recipient, uint256 ethAmountNow, uint256 cumulativeUnlockThreshold);
    event DepositRewards(address indexed recipient, uint256 afEthAmount, uint256 ethAmount);

    event QuickActionsConfigured(
        uint256 stakeFeeBps, uint256 unstakeFeeBps, uint256 maxSingleQuickStake, uint256 maxSingleQuickUnstake
    );

    function deposit(uint256, uint256) external payable returns (uint256);

    function depositRewardsAndRebalance(
        uint256 ethPerCvxMin,
        uint256 ethPerSfrxMin,
        uint256 ethPerSfrxMax,
        uint256 deadline
    ) external payable;
}
