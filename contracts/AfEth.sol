// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "contracts/strategies/votium/VotiumStrategy.sol";
import "contracts/external_interfaces/IVotiumStrategy.sol";
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

    struct WithdrawInfo {
        address owner;
        uint256 amount;
        uint256 safEthWithdrawAmount;
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

    address private constant CVX_ADDRESS =
        0x4e3FBD56CD56c3e72c1403e103b45Db9da5B9D2B;
    address private constant VLCVX_ADDRESS =
        0x72a19342e8F1838460eBFCCEf09F6585e32db86E;

    uint256 public pendingSafEthWithdraws;

    modifier onlyWithdrawIdOwner(uint256 withdrawId) {
        if (withdrawIdInfo[withdrawId].owner != msg.sender) revert NotOwner();
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
        _transferOwnership(msg.sender);
        ratio = 5e17;
    }

    /**
     * @notice - Sets the strategy addresses for safEth and votium
     * @param _vEthAddress - vEth strategy address
     */
    function setStrategyAddress(address _vEthAddress) external onlyOwner {
        vEthAddress = _vEthAddress;
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
        AbstractStrategy vEthStrategy = AbstractStrategy(vEthAddress);
        uint256 safEthValueInEth = (ISafEth(SAF_ETH_ADDRESS).approxPrice(true) *
            safEthBalanceMinusPending()) / 1e18;
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

        AbstractStrategy vStrategy = AbstractStrategy(vEthAddress);

        uint256 sValue = (amount * ratio) / 1e18;
        uint256 sMinted = sValue > 0
            ? ISafEth(SAF_ETH_ADDRESS).stake{value: sValue}(0)
            : 0;
        uint256 vValue = (amount * (1e18 - ratio)) / 1e18;
        uint256 vMinted = vValue > 0 ? vStrategy.deposit{value: vValue}() : 0;
        totalValue +=
            (sMinted * ISafEth(SAF_ETH_ADDRESS).approxPrice(true)) +
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

        uint256 votiumBalance = IERC20(vEthAddress).balanceOf(address(this));
        uint256 votiumWithdrawAmount = (withdrawRatio * votiumBalance) / 1e18;
        uint256 vEthWithdrawId = AbstractStrategy(vEthAddress).requestWithdraw(
            votiumWithdrawAmount
        );

        uint256 safEthBalance = safEthBalanceMinusPending();

        uint256 safEthWithdrawAmount = (withdrawRatio * safEthBalance) / 1e18;

        pendingSafEthWithdraws += safEthWithdrawAmount;

        withdrawIdInfo[latestWithdrawId]
            .safEthWithdrawAmount = safEthWithdrawAmount;
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
    */
    function withdraw(
        uint256 _withdrawId,
        uint256 _minout
    ) external virtual onlyWithdrawIdOwner(_withdrawId) {
        if (pauseWithdraw) revert Paused();
        uint256 ethBalanceBefore = address(this).balance;
        WithdrawInfo memory withdrawInfo = withdrawIdInfo[_withdrawId];
        if (!canWithdraw(_withdrawId)) revert CanNotWithdraw();

        ISafEth(SAF_ETH_ADDRESS).unstake(withdrawInfo.safEthWithdrawAmount, 0);
        AbstractStrategy(vEthAddress).withdraw(withdrawInfo.vEthWithdrawId);

        _burn(address(this), withdrawIdInfo[_withdrawId].amount);
        uint256 ethBalanceAfter = address(this).balance;
        uint256 ethReceived = ethBalanceAfter - ethBalanceBefore;

        pendingSafEthWithdraws -= withdrawInfo.safEthWithdrawAmount;

        if (ethReceived < _minout) revert BelowMinOut();
        // solhint-disable-next-line
        (bool sent, ) = msg.sender.call{value: ethReceived}("");
        if (!sent) revert FailedToSend();
    }

    /**
     * @notice - sells _amount of eth from votium contract
     * @dev - puts it into safEthStrategy or votiumStrategy, whichever is underweight.\
     * @param _amount - amount of eth to sell
     */
    function depositRewards(uint256 _amount) public payable {
        IVotiumStrategy votiumStrategy = IVotiumStrategy(vEthAddress);
        uint256 feeAmount = (_amount * protocolFee) / 1e18;
        if (feeAmount > 0) {
            // solhint-disable-next-line
            (bool sent, ) = feeAddress.call{value: feeAmount}("");
            if (!sent) revert FailedToSend();
        }
        uint256 amount = _amount - feeAmount;
        uint256 safEthTvl = (ISafEth(SAF_ETH_ADDRESS).approxPrice(true) *
            safEthBalanceMinusPending()) / 1e18;
        uint256 votiumTvl = ((votiumStrategy.cvxPerVotium() *
            votiumStrategy.ethPerCvx(true)) *
            IERC20(vEthAddress).balanceOf(address(this))) / 1e36;
        uint256 totalTvl = (safEthTvl + votiumTvl);
        uint256 safEthRatio = (safEthTvl * 1e18) / totalTvl;
        if (safEthRatio < ratio) {
            ISafEth(SAF_ETH_ADDRESS).stake{value: amount}(0);
        } else {
            votiumStrategy.depositRewards{value: amount}(amount);
        }
    }

    function safEthBalanceMinusPending() public view returns (uint256) {
        return
            IERC20(SAF_ETH_ADDRESS).balanceOf(address(this)) -
            pendingSafEthWithdraws;
    }

    receive() external payable {}
}
