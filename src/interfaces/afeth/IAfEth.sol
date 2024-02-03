// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IAfEth is IERC20 {
    error StrategyAlreadyAdded();
    error InvalidFee();
    error Paused();
    error WithdrawingLockedRewards();
    error BelowMinOut();
    error AboveMaxIn();
    error StaleAction();
    error NotAuthorizedToRebalance();
    error InvalidShare();
    error InitialDepositBelowMinOut();
    error TooMuchInitializationEth();

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

    /**
     * @param cvxPerEthMin Minimum accepted CVX/ETH price when converting ETH to CVX.
     * @param sfrxPerEthMin Minimum accepted sfrxETH/ETH price when converting ETH to sfrxETH.
     * @param ethPerSfrxMin Minimum accepted ETH/sfrxETH price when converting sfrxETH to ETH.
     * @param deadline Last timestamp at which this call will be valid.
     */
    struct RebalanceParams {
        uint256 cvxPerEthMin;
        uint256 sfrxPerEthMin;
        uint256 ethPerSfrxMin;
        uint256 deadline;
    }

    function depositRewardsAndRebalance(RebalanceParams calldata params) external payable;

    function quickDeposit(uint256 minOut, uint256 deadline) external payable returns (uint256 afEthOut);

    function quickDeposit(address to, uint256 minOut, uint256 deadline) external payable returns (uint256 afEthOut);

    function quickWithdraw(uint256 amount, uint256 minOut, uint256 deadline) external returns (uint256 ethOut);

    function quickWithdraw(address to, uint256 amount, uint256 minOut, uint256 deadline)
        external
        returns (uint256 ethOut);

    function reportValue()
        external
        view
        returns (
            uint256 activeSfrxRatio,
            uint256 sfrxStrategyValue,
            uint256 votiumValue,
            uint256 unlockedInactiveRewards,
            uint256 lockedRewards
        );
}
