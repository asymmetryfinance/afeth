// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IAfEth {
    error StrategyAlreadyAdded();
    error StrategyNotFound();
    error InsufficientBalance();
    error InvalidStrategy();
    error InvalidFee();
    error CanNotWithdraw();
    error NotOwner();
    error FailedToSend();
    error FailedToDeposit();
    error Paused();
    error BelowMinOut();
    error StaleAction();
    error NotManagerOrRewarder();
    error InvalidRatio();
    error PreminterMaxBuy();
    error PreminterMaxSell();
    error PreminterMinout();

    event SetStrategyAddress(address indexed newAddress);
    event SetRewarderAddress(address indexed newAddress);
    event SetRatio(uint256 indexed newRatio);
    event SetFeeAddress(address indexed newFeeAddress);
    event SetProtocolFee(uint256 indexed newProtocolFee);
    event SetPauseDeposit(bool indexed paused);
    event SetPauseWithdraw(bool indexed paused);
    event Deposit(address indexed recipient, uint256 afEthAmount, uint256 ethAmount);
    event RequestWithdraw(address indexed account, uint256 amount, uint256 withdrawId, uint256 withdrawTime);
    event Withdraw(address indexed recipient, uint256 afEthAmount, uint256 ethAmount, uint256 withdrawId);
    event DepositRewards(address indexed recipient, uint256 afEthAmount, uint256 ethAmount);
    event PremintSetMaxAmounts(uint256 buyAmount, uint256 sellAmount);
    event PremintSetFees(uint256 minSellFee, uint256 maxSellFee);
    event PremintDeposit(uint256 afEthAmount, uint256 ethAmount);
    event PremintWithdraw(uint256 afEthAmount, uint256 ethAmount);
    event PremintBuy(uint256 afEthBought, uint256 ethSpent);
    event PremintSell(uint256 afEthSold, uint256 ethReceived);

    function deposit(uint256, uint256) external payable returns (uint256);

    function depositRewards(uint256 safEthMinOut, uint256 cvxMinOut, uint256 deadline) external payable;
}
