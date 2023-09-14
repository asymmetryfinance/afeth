// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "./strategies/votiumErc20/VotiumErc20Strategy.sol";
import "./strategies/safEth/SafEthStrategy.sol";
import "./strategies/AbstractErc20Strategy.sol";

// AfEth is the strategy manager for safEth and votium strategies
contract AfEth is Initializable, OwnableUpgradeable, ERC20Upgradeable {
    struct StrategyInfo {
        address strategyAddress;
        uint256 ratio;
    }
    StrategyInfo public safEthInfo; // SafEth Strategy Info
    StrategyInfo public vEthInfo; // Votium Strategy Info
    uint256 public totalRatio;
    uint256 public latestWithdrawId;

    struct WithdrawInfo {
        address owner;
        uint256 amount;
        uint256 safEthWithdrawId;
        uint256 vEthWithdrawId;
    }
    mapping(uint256 => WithdrawInfo) public withdrawIdInfo;
    bool public pauseDeposit;
    bool public pauseWithdraw;

    error StrategyAlreadyAdded();
    error StrategyNotFound();
    error InsufficientBalance();
    error InvalidStrategy();
    error CanNotWithdraw();
    error NotOwner();
    error FailedToSend();
    error FailedToDeposit();
    error Paused();
    error BelowMinOut();

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
    }

    /**
        @notice - Initialize values for the contracts
        @dev - This replaces the constructor for upgradeable contracts
        @param _safEthAddress - Address of the safEth strategy
        @param _vEthAddress - Address of the vEth strategy
    */
    function initializeStrategies(
        address _safEthAddress,
        address _vEthAddress
    ) external onlyOwner {
        if (safEthInfo.strategyAddress != address(0))
            revert StrategyAlreadyAdded();
        safEthInfo.strategyAddress = _safEthAddress;
        safEthInfo.ratio = 7e17;
        vEthInfo.strategyAddress = _vEthAddress;
        vEthInfo.ratio = 3e17;
        totalRatio = safEthInfo.ratio + vEthInfo.ratio;
    }

    /**
        @notice - Add strategies to the strategies array
        @dev - To remove a strategy just set ratio to zero
        @param _strategyAddress - Address of the strategy contract
        @param _ratio - Ratio for the strategy
    */
    function updateRatio(
        address _strategyAddress,
        uint256 _ratio
    ) external onlyOwner {
        if (safEthInfo.strategyAddress == _strategyAddress) {
            changeRatio(safEthInfo, _ratio);
            return;
        } else if (vEthInfo.strategyAddress == _strategyAddress) {
            changeRatio(vEthInfo, _ratio);
            return;
        }
        revert StrategyNotFound();
    }

    /**
        @notice - Private function to update ratio
        @param _strategy - Strategy to update ratio
        @param _ratio - Ratio to update to
    */
    function changeRatio(
        StrategyInfo storage _strategy,
        uint256 _ratio
    ) private {
        unchecked {
            totalRatio -= _strategy.ratio;
            totalRatio += _ratio;
        }
        _strategy.ratio = _ratio;
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
            safEthInfo.strategyAddress
        );
        AbstractErc20Strategy vEthStrategy = AbstractErc20Strategy(
            vEthInfo.strategyAddress
        );
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
        AbstractErc20Strategy safEthStrategy = AbstractErc20Strategy(
            safEthInfo.strategyAddress
        );
        AbstractErc20Strategy vEthStrategy = AbstractErc20Strategy(
            vEthInfo.strategyAddress
        );
        uint256 safEthMintAmount = safEthInfo.ratio > 0
            ? safEthStrategy.deposit{
                value: (amount * safEthInfo.ratio) / totalRatio
            }()
            : 0;
        uint256 vEthMintAmount = vEthInfo.ratio > 0
            ? vEthStrategy.deposit{
                value: (amount * vEthInfo.ratio) / totalRatio
            }()
            : 0;
        if (safEthMintAmount > 0)
            totalValue += safEthMintAmount * safEthStrategy.price();
        if (vEthMintAmount > 0)
            totalValue += vEthMintAmount * vEthStrategy.price();
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
            safEthInfo.strategyAddress,
            withdrawRatio
        );
        uint256 vEthWithdrawId = requestWithdrawFromStrategy(
            vEthInfo.strategyAddress,
            withdrawRatio
        );
        withdrawIdInfo[latestWithdrawId].safEthWithdrawId = safEthWithdrawId;
        withdrawIdInfo[latestWithdrawId].vEthWithdrawId = vEthWithdrawId;

        withdrawIdInfo[latestWithdrawId].owner = msg.sender;
        withdrawIdInfo[latestWithdrawId].amount = _amount;
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
        @param _safethWithdrawId - Id of the withdraw request for SafEth
        @param _vEthWithdrawId - Id of the withdraw request for vEth
        @return - Bool if withdraw can be executed
    */
    function canWithdraw(
        uint256 _safethWithdrawId,
        uint256 _vEthWithdrawId
    ) public view returns (bool) {
        return
            AbstractErc20Strategy(safEthInfo.strategyAddress).canWithdraw(
                _safethWithdrawId
            ) &&
            AbstractErc20Strategy(vEthInfo.strategyAddress).canWithdraw(
                _vEthWithdrawId
            );
    }

    /**
        @notice - Get's the withdraw time for an amount of AfEth
        @param _amount - Amount of afETH to withdraw
        @return - Highest withdraw time of the strategies
    */
    function withdrawTime(uint256 _amount) public view returns (uint256) {
        uint256 safEthTime = AbstractErc20Strategy(safEthInfo.strategyAddress)
            .withdrawTime(_amount);
        uint256 vEthTime = AbstractErc20Strategy(vEthInfo.strategyAddress)
            .withdrawTime(_amount);
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
        if (
            !canWithdraw(
                withdrawInfo.safEthWithdrawId,
                withdrawInfo.vEthWithdrawId
            )
        ) revert CanNotWithdraw();

        AbstractErc20Strategy(safEthInfo.strategyAddress).withdraw(
            withdrawInfo.safEthWithdrawId
        );
        AbstractErc20Strategy(vEthInfo.strategyAddress).withdraw(
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

    receive() external payable {}
}
