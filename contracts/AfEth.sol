// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "contracts/strategies/votium/VotiumStrategy.sol";
import "contracts/external_interfaces/IVotiumStrategy.sol";
import "contracts/external_interfaces/ISafEth.sol";
import "contracts/strategies/AbstractStrategy.sol";

// AfEth is the strategy manager for safEth and votium strategies
contract AfEth is Initializable, OwnableUpgradeable, ERC20Upgradeable {
    uint256 public ratio;
    uint256 public protocolFee;
    address public feeAddress;
    address public constant SAF_ETH_ADDRESS =
        0x6732Efaf6f39926346BeF8b821a04B6361C4F3e5;
    address public vEthAddress; // Votium Strategy Address
    uint256 public latestWithdrawId;
    address public rewarder;
    uint256 public pendingSafEthWithdraws;
    uint256 public trackedvStrategyBalance;
    uint256 public trackedsafEthBalance;
    bool public pauseDeposit;
    bool public pauseWithdraw;

    // eth balance held by contract for premint functionality
    uint256 public preminterEthBalance;
    // afEth balance held by contract for premint functionality
    uint256 public preminterAfEthBalance;
    // fee percent charged if withdraw time is 0
    uint256 public preminterMinFee;
    // fee percent charged if withdraw time is 17 weeks
    uint256 public preminterMaxFee;
    // max afEth that can be sold at once
    uint256 public preminterMaxSell;
    // max amount of eth that can be spent at once buying afEth
    uint256 public preminterMaxBuy;

    struct WithdrawInfo {
        address owner;
        uint256 amount;
        uint256 safEthWithdrawAmount;
        uint256 votiumWithdrawAmount;
        uint256 vEthWithdrawId;
        uint256 withdrawTime;
    }

    mapping(uint256 => WithdrawInfo) public withdrawIdInfo;

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
    event Deposit(
        address indexed recipient,
        uint256 afEthAmount,
        uint256 ethAmountdfsdf
    );
    event RequestWithdraw(
        address indexed account,
        uint256 amount,
        uint256 withdrawId,
        uint256 withdrawTime
    );
    event Withdraw(
        address indexed recipient,
        uint256 afEthAmount,
        uint256 ethAmount,
        uint256 withdrawId
    );
    event DepositRewards(
        address indexed recipient,
        uint256 afEthAmount,
        uint256 ethAmount
    );
    event PremintSetFees(uint256 minSellFee, uint256 maxSellFee);
    event PremintDeposit(uint256 afEthAmount, uint256 ethAmount);
    event PremintWithdraw(uint256 afEthAmount, uint256 ethAmount);
    event PremintBuy(uint256 afEthBought, uint256 ethSpent);
    event PremintSell(uint256 afEthSold, uint256 ethReceived);

    modifier onlyWithdrawIdOwner(uint256 withdrawId) {
        if (withdrawIdInfo[withdrawId].owner != msg.sender) revert NotOwner();
        _;
    }

    modifier onlyVotiumOrRewarder() {
        if (msg.sender != rewarder && msg.sender != vEthAddress)
            revert NotManagerOrRewarder();
        _;
    }

    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
        @notice - Initialize values for the contracts
        @dev - This replaces the constructor for upgradeable contracts
    */
    function initialize() external initializer {
        __ERC20_init("Asymmetry Finance AfEth", "AfEth");
        _transferOwnership(msg.sender);
        ratio = 5e17;
    }

    /**
     * @notice - Sets the strategy addresses for safEth and votium
     * @param _vEthAddress - vEth strategy address
     */
    function setStrategyAddress(address _vEthAddress) external onlyOwner {
        vEthAddress = _vEthAddress;
        emit SetStrategyAddress(_vEthAddress);
    }

    /**
     * @notice - Sets the rewarder address
     * @param _rewarder - rewarder address
     */
    function setRewarderAddress(address _rewarder) external onlyOwner {
        rewarder = _rewarder;
        emit SetRewarderAddress(_rewarder);
    }

    /**
        @notice - Sets the target ratio of safEth to votium. 
        @notice target ratio is maintained by directing rewards into either safEth or votium strategy
        @param _newRatio - New ratio of safEth to votium
    */
    function setRatio(uint256 _newRatio) external onlyOwner {
        if (_newRatio > 1e18) revert InvalidRatio();
        ratio = _newRatio;
        emit SetRatio(_newRatio);
    }

    /**
        @notice - Sets the protocol fee address which takes a percentage of the rewards.
        @param _newFeeAddress - New protocol fee address to collect rewards
    */
    function setFeeAddress(address _newFeeAddress) external onlyOwner {
        feeAddress = _newFeeAddress;
        emit SetFeeAddress(_newFeeAddress);
    }

    /**
        @notice - Sets the protocol fee which takes a percentage of the rewards.
        @param _newFee - New protocol fee
    */
    function setProtocolFee(uint256 _newFee) external onlyOwner {
        if (_newFee > 1e18) revert InvalidFee();
        protocolFee = _newFee;
        emit SetProtocolFee(_newFee);
    }

    /**
        @notice - Enables/Disables depositing
        @param _pauseDeposit - Bool to set pauseDeposit

    */
    function setPauseDeposit(bool _pauseDeposit) external onlyOwner {
        pauseDeposit = _pauseDeposit;
        emit SetPauseDeposit(_pauseDeposit);
    }

    /**
        @notice - Enables/Disables withdrawing & requesting to withdraw
        @param _pauseWithdraw - Bool to set pauseWithdraw
    */
    function setPauseWithdraw(bool _pauseWithdraw) external onlyOwner {
        pauseWithdraw = _pauseWithdraw;
        emit SetPauseWithdraw(_pauseWithdraw);
    }

    /**
        @notice - Get's the price of afEth
        @dev - Checks each strategy and calculates the total value in ETH divided by supply of afETH tokens
        @param _validate - Validates the chainlink oracle price
        @return - Price of afEth
    */
    function price(bool _validate) public view returns (uint256) {
        uint256 totalSupply = totalSupply();
        if (totalSupply == 0) return 1e18;
        AbstractStrategy vEthStrategy = AbstractStrategy(vEthAddress);
        uint256 safEthValueInEth = (ISafEth(SAF_ETH_ADDRESS).approxPrice(
            _validate
        ) * safEthBalanceMinusPending()) / 1e18;
        uint256 vEthValueInEth = (vEthStrategy.price(_validate) *
            trackedvStrategyBalance) / 1e18;
        return ((vEthValueInEth + safEthValueInEth) * 1e18) / totalSupply;
    }

    /**
        @notice - Deposits into each strategy
        @dev - This is the entry into the protocol
        @param _minout - Minimum amount of afEth to mint
        @param _deadline - Sets a deadline for the deposit
    */
    function deposit(
        uint256 _minout,
        uint256 _deadline
    ) external payable virtual {
        if (pauseDeposit) revert Paused();
        if (block.timestamp > _deadline) revert StaleAction();
        uint256 priceBeforeDeposit = price(true);
        uint256 totalValue;

        AbstractStrategy vStrategy = AbstractStrategy(vEthAddress);

        uint256 sValue = (msg.value * ratio) / 1e18;
        uint256 sMinted = sValue > 0
            ? ISafEth(SAF_ETH_ADDRESS).stake{value: sValue}(0)
            : 0;
        uint256 vValue = (msg.value - sValue);
        uint256 vMinted = vValue > 0 ? vStrategy.deposit{value: vValue}() : 0;
        totalValue =
            (sMinted * ISafEth(SAF_ETH_ADDRESS).approxPrice(true)) +
            (vMinted * vStrategy.price(true));
        trackedvStrategyBalance += vMinted;
        trackedsafEthBalance += sMinted;
        if (totalValue == 0) revert FailedToDeposit();
        uint256 amountToMint = totalValue / priceBeforeDeposit;
        if (amountToMint < _minout) revert BelowMinOut();
        _mint(msg.sender, amountToMint);
        emit Deposit(msg.sender, amountToMint, msg.value);
    }

    /**
        @notice - Request to close position
        @param _amount - Amount of afEth to withdraw
    */
    function requestWithdraw(uint256 _amount) external virtual {
        if (pauseWithdraw) revert Paused();
        latestWithdrawId++;
        uint256 withdrawId = latestWithdrawId;

        uint256 withdrawRatio = (_amount * 1e18) / totalSupply();

        _burn(msg.sender, _amount);

        uint256 votiumWithdrawAmount = (withdrawRatio *
            trackedvStrategyBalance) / 1e18;
        uint256 withdrawTimeBefore = withdrawTime(votiumWithdrawAmount);
        uint256 vEthWithdrawId = AbstractStrategy(vEthAddress).requestWithdraw(
            votiumWithdrawAmount
        );
        trackedvStrategyBalance -= votiumWithdrawAmount;

        uint256 safEthBalance = safEthBalanceMinusPending();

        uint256 safEthWithdrawAmount = (withdrawRatio * safEthBalance) / 1e18;

        pendingSafEthWithdraws += safEthWithdrawAmount;

        withdrawIdInfo[withdrawId].safEthWithdrawAmount = safEthWithdrawAmount;
        withdrawIdInfo[withdrawId].votiumWithdrawAmount = votiumWithdrawAmount;
        withdrawIdInfo[withdrawId].vEthWithdrawId = vEthWithdrawId;

        withdrawIdInfo[withdrawId].owner = msg.sender;
        withdrawIdInfo[withdrawId].amount = _amount;
        withdrawIdInfo[withdrawId].withdrawTime = withdrawTimeBefore;

        emit RequestWithdraw(
            msg.sender,
            _amount,
            withdrawId,
            withdrawTimeBefore
        );
    }

    /**
        @notice - Checks if withdraw can be executed from withdrawId
        @param _withdrawId - Id of the withdraw request for SafEth
        @return - Bool if withdraw can be executed
    */
    function canWithdraw(uint256 _withdrawId) public view returns (bool) {
        return
            AbstractStrategy(vEthAddress).canWithdraw(
                withdrawIdInfo[_withdrawId].vEthWithdrawId
            );
    }

    /**
        @notice - Get's the withdraw time for an amount of AfEth
        @param _amount - Amount of afETH to withdraw
        @return - Highest withdraw time of the strategies
    */
    function withdrawTime(uint256 _amount) public view returns (uint256) {
        return AbstractStrategy(vEthAddress).withdrawTime(_amount);
    }

    /**
        @notice - Withdraw from each strategy
        @param _withdrawId - Id of the withdraw request
        @param _minout - Minimum amount of ETH to receive
        @param _deadline - Sets a deadline for the deposit
    */
    function withdraw(
        uint256 _withdrawId,
        uint256 _minout,
        uint256 _deadline
    ) external virtual onlyWithdrawIdOwner(_withdrawId) {
        if (pauseWithdraw) revert Paused();
        if (block.timestamp > _deadline) revert StaleAction();
        uint256 ethBalanceBefore = address(this).balance;
        WithdrawInfo storage withdrawInfo = withdrawIdInfo[_withdrawId];

        if (withdrawInfo.safEthWithdrawAmount > 0) {
            ISafEth(SAF_ETH_ADDRESS).unstake(
                withdrawInfo.safEthWithdrawAmount,
                0
            );
            trackedsafEthBalance -= withdrawInfo.safEthWithdrawAmount;
        }
        AbstractStrategy(vEthAddress).withdraw(withdrawInfo.vEthWithdrawId);
        uint256 ethBalanceAfter = address(this).balance;
        uint256 ethReceived = ethBalanceAfter - ethBalanceBefore;

        pendingSafEthWithdraws -= withdrawInfo.safEthWithdrawAmount;

        if (ethReceived < _minout) revert BelowMinOut();
        // solhint-disable-next-line
        (bool sent, ) = msg.sender.call{value: ethReceived}("");
        if (!sent) revert FailedToSend();
        emit Withdraw(
            msg.sender,
            withdrawInfo.amount,
            ethReceived,
            _withdrawId
        );
    }

    /**
     * @notice - sells _amount of eth from votium contract
     * @dev - puts it into safEthStrategy or votiumStrategy, whichever is underweight.\
     * @param _safEthMinout - Minimum amount of safEth to receive from rewards when buying safEth
     * @param _cvxMinout - Minimum amount of cvx to receive from rewards when buying vAfEth
     */
    function depositRewards(
        uint256 _safEthMinout,
        uint256 _cvxMinout,
        uint256 _deadline
    ) public payable onlyVotiumOrRewarder {
        require(!pauseDeposit, "paused");
        if (block.timestamp > _deadline) revert StaleAction();
        IVotiumStrategy votiumStrategy = IVotiumStrategy(vEthAddress);
        uint256 feeAmount = (msg.value * protocolFee) / 1e18;
        if (feeAmount > 0) {
            // solhint-disable-next-line
            (bool sent, ) = feeAddress.call{value: feeAmount}("");
            if (!sent) revert FailedToSend();
        }
        uint256 amount = msg.value - feeAmount;
        uint256 safEthTvl = (ISafEth(SAF_ETH_ADDRESS).approxPrice(true) *
            safEthBalanceMinusPending()) / 1e18;
        uint256 votiumTvl = ((votiumStrategy.cvxPerVotium() *
            votiumStrategy.ethPerCvx(true)) * trackedvStrategyBalance) / 1e36;
        uint256 totalTvl = (safEthTvl + votiumTvl);
        uint256 safEthRatio = (safEthTvl * 1e18) / totalTvl;
        if (safEthRatio < ratio) {
            uint256 safEthReceived = ISafEth(SAF_ETH_ADDRESS).stake{
                value: amount
            }(_safEthMinout);
            trackedsafEthBalance += safEthReceived;
        } else {
            votiumStrategy.depositRewards{value: amount}(amount, _cvxMinout);
        }
        emit DepositRewards(msg.sender, amount, msg.value);
    }

    function safEthBalanceMinusPending() public view returns (uint256) {
        return trackedsafEthBalance - pendingSafEthWithdraws;
    }

    receive() external payable {}

    /**
     * @notice Allow owner to withdraw from Preminter
     * @param _ethAmount amount of eth to withdraw
     * @param _afEthAmount amount of afEth to withdraw
     */
    function premintWithdraw(
        uint256 _ethAmount,
        uint256 _afEthAmount
    ) public onlyOwner {
        if (_ethAmount > 0) {
            if (_ethAmount > preminterEthBalance) revert InsufficientBalance();
            // solhint-disable-next-line
            (bool sent, ) = feeAddress.call{value: _ethAmount}("");
            if (!sent) revert FailedToSend();
            preminterEthBalance -= _ethAmount;
        }
        if (_afEthAmount > 0) {
            if (_afEthAmount > preminterAfEthBalance)
                revert InsufficientBalance();
            _transfer(address(this), msg.sender, _afEthAmount);
            preminterAfEthBalance -= _afEthAmount;
        }
        emit PremintWithdraw(_afEthAmount, _ethAmount);
    }

    /**
     * @notice Allow owner to deposit into Preminter
     * @param _afEthAmount amount of afEth to deposit
     */
    function premintDeposit(uint256 _afEthAmount) public payable onlyOwner {
        if (_afEthAmount > 0) {
            _transfer(msg.sender, address(this), _afEthAmount);
            preminterAfEthBalance += _afEthAmount;
        }
        if (msg.value > 0) {
            preminterEthBalance += msg.value;
        }
        emit PremintDeposit(_afEthAmount, msg.value);
    }

    /**
     * @notice Sets sell fee used in selling afEth afEth (Immediate Unstake Premtium)
     * @param _minSellFee minimum sell fee % to charge if there is 0 weeks to unstake
     * @param _minSellFee maximum sell fee % to charge if there is 16 weeks to unstake
     */
    function premintSetFees(
        uint256 _minSellFee,
        uint256 _maxSellFee
    ) public onlyOwner {
        preminterMinFee = _maxSellFee;
        preminterMaxFee = _minSellFee;
        emit PremintSetFees(_minSellFee, _maxSellFee);
    }

    /**
     * @notice Buy afEth from Preminter
     * @param _minOut minimum afEth to receive or revert
     */
    function premintBuy(uint256 _minOut) public payable {
        if (msg.value > preminterMaxBuy) revert PreminterMaxBuy();
        uint256 afEthOut = premintBuyAmount(msg.value);
        if (afEthOut < _minOut) revert PreminterMinout();
        _transfer(address(this), msg.sender, afEthOut);
        emit PremintBuy(afEthOut, msg.value);
    }

    /**
     * Sell afEth to preminter
     * @param _afEthToSell amount of afEth to sell
     * @param _ethMinOut minimum eth to receive or revert
     */
    function premintSell(uint256 _afEthToSell, uint256 _ethMinOut) public {
        if (_afEthToSell > preminterMaxSell) revert PreminterMaxSell();
        uint256 ethOut = premintSellAmount(_afEthToSell);
        if (ethOut < _ethMinOut) revert PreminterMinout();
        _transfer(msg.sender, address(this), _afEthToSell);
        // solhint-disable-next-line
        (bool sent, ) = address(msg.sender).call{value: ethOut}("");
        if (!sent) revert FailedToSend();
        emit PremintSell(_afEthToSell, ethOut);
    }

    /**
     * @notice Returns expected afEth out for a given eth amount
     * @param _ethAmount amount of eth simulate buy with
     * @return afEth out for a given eth amount
     */
    function premintBuyAmount(
        uint256 _ethAmount
    ) public view returns (uint256) {
        return ((_ethAmount * 1e18) / price(true));
    }

    /**
     * @notice Returns expected eth out for a given afEth amount
     * @param _afEthToSell amount of afEth simulate sell with
     * @return eth amount out for a given eth amount
     */
    function premintSellAmount(
        uint256 _afEthToSell
    ) public view returns (uint256) {
        uint256 sellAmount = (_afEthToSell * price(true)) / 1e18;
        uint256 sellAmountMinusFee = (sellAmount *
            (1e18 - premintSellFeePercent(_afEthToSell))) / 1e18;
        return sellAmountMinusFee;
    }

    /**
     * @notice calculates fee percent to be charged on selling afEth instantly instead of unstaking normally
     * @param _afEthToSell amount of afEth to sell
     * @return fee % to charge for selling afEth instantly instead of unstaking normally
     */
    function premintSellFeePercent(
        uint256 _afEthToSell
    ) public view returns (uint256) {
        uint256 maxPossibleWithdrawTime = 24 * 60 * 60 * 7 * 17; // 17 epochs
        // how long until they could normally unstake
        uint256 withdrawTimeRemaining = withdrawTime(_afEthToSell) -
            block.timestamp;
        // what % of the way through the unstake period are they
        uint256 withdrawTimePercent = (withdrawTimeRemaining * 1e18) /
            maxPossibleWithdrawTime;
        // expected fee based on how far through the unstake period they are
        return
            preminterMinFee +
            ((preminterMaxFee - preminterMinFee) * withdrawTimePercent) /
            1e18;
    }
}
