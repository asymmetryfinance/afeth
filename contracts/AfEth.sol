// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "./strategies/votiumErc20/VotiumErc20Strategy.sol";
import "./strategies/safEth/SafEthStrategy.sol";
import "./strategies/AbstractErc20Strategy.sol";
import "./external_interfaces/IVotiumStrategy.sol";

// AfEth is the strategy manager for safEth and votium strategies
contract AfEth is Initializable, OwnableUpgradeable, ERC20Upgradeable {
    uint256 public ratio;
    uint256 public protocolFee;
    address public feeAddress;
    address public safEthAddress; // SafEth Strategy Address
    address public vEthAddress; // Votium Strategy Address
    uint256 public latestWithdrawId;

    struct WithdrawInfo {
        address owner;
        uint256 amount;
        uint256 safEthWithdrawId;
        uint256 vEthWithdrawId;
        uint256 withdrawTime;
    }

    mapping(uint256 => WithdrawInfo) public withdrawIdInfo;
    bool public pauseDeposit;
    bool public pauseWithdraw;

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

    event WithdrawRequest(
        address indexed account,
        uint256 amount,
        uint256 withdrawId,
        uint256 withdrawTime
    );

    address constant CVX_ADDRESS = 0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B;
    address constant VLCVX_ADDRESS = 0x72a19342e8F1838460eBFCCEf09F6585e32db86E;

    modifier onlyWithdrawIdOwner(uint256 withdrawId) {
        if (withdrawIdInfo[withdrawId].owner != msg.sender) revert NotOwner();
        _;
    }

    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function setStrategyAddresses(
        address _safEthAddress,
        address _vEthAddress
    ) external onlyOwner {
        safEthAddress = _safEthAddress;
        vEthAddress = _vEthAddress;
    }

    /**
        @notice - Initialize values for the contracts
        @dev - This replaces the constructor for upgradeable contracts
    */
    function initialize() external initializer {
        _transferOwnership(msg.sender);
        ratio = 5e17;
    }

    /**
        @notice - Sets the target ratio of safEth to votium. 
        @notice target ratio is maintained by directing rewards into either safEth or votium strategy
        @param _newRatio - New ratio of safEth to votium
    */
    function setRatio(uint256 _newRatio) public onlyOwner {
        ratio = _newRatio;
    }

    /**
        @notice - Sets the protocol fee address which takes a percentage of the rewards.
        @param _newFeeAddress - New protocol fee address to collect rewards
    */
    function setFeeAddress(address _newFeeAddress) public onlyOwner {
        feeAddress = _newFeeAddress;
    }

    /**
        @notice - Sets the protocol fee which takes a percentage of the rewards.
        @param _newFee - New protocol fee
    */
    function setProtocolFee(uint256 _newFee) public onlyOwner {
        if (_newFee > 1e18) revert InvalidFee();
        protocolFee = _newFee;
    }

    /**
        @notice - Enables/Disables depositing
        @param _pauseDeposit - Bool to set pauseDeposit

    */
    function setPauseDeposit(bool _pauseDeposit) external onlyOwner {
        pauseDeposit = _pauseDeposit;
    }

    /**
        @notice - Enables/Disables withdrawing & requesting to withdraw
        @param _pauseWithdraw - Bool to set pauseWithdraw
    */
    function setPauseWithdraw(bool _pauseWithdraw) external onlyOwner {
        pauseWithdraw = _pauseWithdraw;
    }

    /**
        @notice - Get's the price of afEth
        @dev - Checks each strategy and calculates the total value in ETH divided by supply of afETH tokens
        @return - Price of afEth
    */
    function price() public view returns (uint256) {
        if (totalSupply() == 0) return 1e18;
        AbstractErc20Strategy safEthStrategy = AbstractErc20Strategy(
            safEthAddress
        );
        AbstractErc20Strategy vEthStrategy = AbstractErc20Strategy(vEthAddress);
        uint256 safEthValueInEth = (safEthStrategy.price() *
            safEthStrategy.balanceOf(address(this))) / 1e18;
        uint256 vEthValueInEth = (vEthStrategy.price() *
            vEthStrategy.balanceOf(address(this))) / 1e18;
        return ((vEthValueInEth + safEthValueInEth) * 1e18) / totalSupply();
    }

    /**
        @notice - Deposits into each strategy
        @dev - This is the entry into the protocol
        @param _minout - Minimum amount of afEth to mint
    */
    function deposit(uint256 _minout) external payable virtual {
        if (pauseDeposit) revert Paused();
        uint256 amount = msg.value;
        uint256 priceBeforeDeposit = price();
        uint256 totalValue;

        AbstractErc20Strategy sStrategy = AbstractErc20Strategy(safEthAddress);
        AbstractErc20Strategy vStrategy = AbstractErc20Strategy(vEthAddress);

        uint256 sValue = (amount * ratio) / 1e18;
        uint256 sMinted = sValue > 0 ? sStrategy.deposit{value: sValue}() : 0;
        uint256 vValue = (amount * (1e18 - ratio)) / 1e18;
        uint256 vMinted = vValue > 0 ? vStrategy.deposit{value: vValue}() : 0;
        totalValue +=
            (sMinted * sStrategy.price()) +
            (vMinted * vStrategy.price());
        if (totalValue == 0) revert FailedToDeposit();
        uint256 amountToMint = totalValue / priceBeforeDeposit;
        if (amountToMint < _minout) revert BelowMinOut();
        _mint(msg.sender, amountToMint);
    }

    /**
        @notice - Request to close position
        @param _amount - Amount of afEth to withdraw
    */
    function requestWithdraw(uint256 _amount) external virtual {
        uint256 withdrawTimeBefore = withdrawTime(_amount);
        if (pauseWithdraw) revert Paused();
        latestWithdrawId++;

        // ratio of afEth being withdrawn to totalSupply
        // we are transfering the afEth to the contract when we requestWithdraw
        // we shouldn't include that in the withdrawRatio
        uint256 afEthBalance = balanceOf(address(this));
        uint256 withdrawRatio = (_amount * 1e18) /
            (totalSupply() - afEthBalance);

        _transfer(msg.sender, address(this), _amount);
        uint256 safEthWithdrawId = requestWithdrawFromStrategy(
            safEthAddress,
            withdrawRatio
        );
        uint256 vEthWithdrawId = requestWithdrawFromStrategy(
            vEthAddress,
            withdrawRatio
        );

        withdrawIdInfo[latestWithdrawId].safEthWithdrawId = safEthWithdrawId;
        withdrawIdInfo[latestWithdrawId].vEthWithdrawId = vEthWithdrawId;

        withdrawIdInfo[latestWithdrawId].owner = msg.sender;
        withdrawIdInfo[latestWithdrawId].amount = _amount;
        withdrawIdInfo[latestWithdrawId].withdrawTime = withdrawTimeBefore;

        emit WithdrawRequest(
            msg.sender,
            _amount,
            latestWithdrawId,
            withdrawTimeBefore
        );
    }

    /**
        @notice - Private function to request withdraw from strategy
        @param _strategyAddress - Strategy address to withdraw from
        @param _withdrawRatio - Ratio of afEth to withdraw
        @return withdrawId - Withdraw id of the strategy
    */
    function requestWithdrawFromStrategy(
        address _strategyAddress,
        uint256 _withdrawRatio
    ) private returns (uint256 withdrawId) {
        uint256 strategyBalance = ERC20Upgradeable(_strategyAddress).balanceOf(
            address(this)
        );
        uint256 strategyWithdrawAmount = (_withdrawRatio * strategyBalance) /
            1e18;
        withdrawId = AbstractErc20Strategy(_strategyAddress).requestWithdraw(
            strategyWithdrawAmount
        );
    }

    /**
        @notice - Checks if withdraw can be executed from withdrawId
        @param _withdrawId - Id of the withdraw request for SafEth
        @return - Bool if withdraw can be executed
    */
    function canWithdraw(uint256 _withdrawId) public view returns (bool) {
        return
            AbstractErc20Strategy(safEthAddress).canWithdraw(
                withdrawIdInfo[_withdrawId].safEthWithdrawId
            ) &&
            AbstractErc20Strategy(vEthAddress).canWithdraw(
                withdrawIdInfo[_withdrawId].vEthWithdrawId
            );
    }

    /**
        @notice - Get's the withdraw time for an amount of AfEth
        @param _amount - Amount of afETH to withdraw
        @return - Highest withdraw time of the strategies
    */
    function withdrawTime(uint256 _amount) public view returns (uint256) {
        uint256 safEthTime = AbstractErc20Strategy(safEthAddress).withdrawTime(
            _amount
        );
        uint256 vEthTime = AbstractErc20Strategy(vEthAddress).withdrawTime(
            _amount
        );
        uint256 highestTime = safEthTime > vEthTime ? safEthTime : vEthTime;

        return highestTime;
    }

    /**
        @notice - Withdraw from each strategy
        @param _withdrawId - Id of the withdraw request
        @param _minout - Minimum amount of ETH to receive
    */
    function withdraw(
        uint256 _withdrawId,
        uint256 _minout
    ) external virtual onlyWithdrawIdOwner(_withdrawId) {
        if (pauseWithdraw) revert Paused();
        uint256 ethBalanceBefore = address(this).balance;
        WithdrawInfo memory withdrawInfo = withdrawIdInfo[_withdrawId];
        if (!canWithdraw(_withdrawId)) revert CanNotWithdraw();

        AbstractErc20Strategy(safEthAddress).withdraw(
            withdrawInfo.safEthWithdrawId
        );
        AbstractErc20Strategy(vEthAddress).withdraw(
            withdrawInfo.vEthWithdrawId
        );

        _burn(address(this), withdrawIdInfo[_withdrawId].amount);
        uint256 ethBalanceAfter = address(this).balance;
        uint256 ethReceived = ethBalanceAfter - ethBalanceBefore;

        if (ethReceived < _minout) revert BelowMinOut();
        // solhint-disable-next-line
        (bool sent, ) = msg.sender.call{value: ethReceived}("");
        if (!sent) revert FailedToSend();
    }

    /**
        @notice - Applies reward to a strategy
        @param _strategyAddress - Address of the strategy to apply reward to
    */
    function applyStrategyReward(address _strategyAddress) public payable {
        AbstractErc20Strategy(_strategyAddress).deposit{value: msg.value}();
    }

    /**
     * @notice - sells _amount of eth from votium contract
     * @dev - puts it into safEthStrategy or votiumStrategy, whichever is underweight.\
     * @param _amount - amount of eth to sell
     *  */
    function depositRewards(uint256 _amount) public payable {
        IVotiumStrategy votiumStrategy = IVotiumStrategy(vEthAddress);
        uint256 feeAmount = (_amount * protocolFee) / 1e18;
        if (feeAmount > 0) {
            // solhint-disable-next-line
            (bool sent, ) = feeAddress.call{value: feeAmount}("");
            if (!sent) revert FailedToSend();
        }
        uint256 amount = _amount - feeAmount;
        uint256 safEthTvl = (ISafEth(0x6732Efaf6f39926346BeF8b821a04B6361C4F3e5)
            .approxPrice(false) * IERC20(safEthAddress).totalSupply()) / 1e18;
        uint256 votiumTvl = ((votiumStrategy.cvxPerVotium() *
            votiumStrategy.ethPerCvx()) * IERC20(vEthAddress).totalSupply()) /
            1e36;
        uint256 totalTvl = (safEthTvl + votiumTvl);
        uint256 safEthRatio = (safEthTvl * 1e18) / totalTvl;
        if (safEthRatio < ratio)
            this.applyStrategyReward{value: amount}(safEthAddress);
        else votiumStrategy.depositRewards{value: amount}(amount);
    }

    receive() external payable {}
}
