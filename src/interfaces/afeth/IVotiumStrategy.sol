// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IVotiumStrategy {
    event FailedToSell(uint256 failedSwapIndex);
    event RewarderSet(address indexed newRewarder);
    event EmergencyShutdown();

    error ExchangeOutputBelowMin();
    error StaleAction();
    error WithdrawalStillLocked();
    error UnexpectedLockedCvxError();
    error UnauthorizedTarget();
    error CvxBalanceChanged();
    error Shutdown();

    function emergencyShutdown() external;

    function deposit() external payable returns (uint256 mintedCvx);

    function requestWithdraw(uint256 share, address to)
        external
        returns (bool locked, uint256 ethOutNow, uint256 cumulativeUnlockThreshold);

    function deposit(uint256 cvxMinOut) external payable returns (uint256 cvxAmount);

    function totalEthValue() external view returns (uint256 totalValue, uint256 ethCvxPrice);
}
