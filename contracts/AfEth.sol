// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "./strategies/votiumErc20/VotiumErc20Strategy.sol";
import "./strategies/safEth/SafEthStrategy.sol";
import "./strategies/AbstractErc20Strategy.sol";

// AfEth is the strategy manager for safEth and votium strategies
contract AfEth is Initializable, OwnableUpgradeable, ERC20Upgradeable {
    struct Strategy {
        address strategyAddress;
        uint256 ratio;
    }
    Strategy[] public strategies; // mapping of strategy address to ratio
    uint256 public totalRatio;
    uint256 public latestWithdrawId;

    struct WithdrawInfo {
        address owner;
        uint256 amount;
        uint256[] strategyWithdrawIds;
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
    error Paused();

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
        @notice - Add strategies to the strategies array
        @dev - These will rarely change, if at all once deployed
        @dev - ERC165 protects against contracts that don't implement the correct interface
        @param _strategy - Address of the strategy contract
        @param _ratio - Ratio for the strategy
    */
    function addStrategy(address _strategy, uint256 _ratio) external onlyOwner {
        try
            ERC165(_strategy).supportsInterface(
                type(AbstractErc20Strategy).interfaceId
            )
        returns (bool supported) {
            // Contract supports ERC-165 but invalid
            if (!supported) revert InvalidStrategy();
        } catch {
            // Contract doesn't support ERC-165
            revert InvalidStrategy();
        }
        uint256 total = 0;
        for (uint256 i = 0; i < strategies.length; i++) {
            unchecked {
                total += strategies[i].ratio;
            }
            if (strategies[i].strategyAddress == _strategy)
                revert StrategyAlreadyAdded();
        }
        Strategy memory strategy = Strategy(_strategy, _ratio);
        strategies.push(strategy);
        totalRatio = total + _ratio;
    }

    /**
        @notice - Add strategies to the strategies array
        @dev - To remove a strategy just set ratio to zero
        @param _strategy - Address of the strategy contract
        @param _ratio - Ratio for the strategy
    */
    function updateRatio(address _strategy, uint256 _ratio) external onlyOwner {
        for (uint256 i = 0; i < strategies.length; i++) {
            if (strategies[i].strategyAddress == _strategy) {
                unchecked {
                    totalRatio -= strategies[i].ratio;
                    totalRatio += _ratio;
                }
                strategies[i].ratio = _ratio;
                return;
            }
        }
        revert StrategyNotFound();
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
        @dev - Loops through each strategy and calculates the total value in ETH divided by supply of afETH tokens
    */
    function price() public view returns (uint256) {
        if (totalSupply() == 0) return 1e18;
        uint256 totalValue = 0;
        for (uint256 i = 0; i < strategies.length; i++) {
            AbstractErc20Strategy strategy = AbstractErc20Strategy(
                strategies[i].strategyAddress
            );
            uint256 strategyValueInEth = (strategy.price() *
                strategy.balanceOf(address(this))) / 1e18;
            totalValue += strategyValueInEth;
        }
        return (totalValue * 1e18) / totalSupply();
    }

    /**
        @notice - Deposits into each strategy
        @dev - This is the entry into the protocol
        @param _minout - Minimum amount of afEth to mint
    */
    function deposit(uint256 _minout) external payable virtual {
        if (pauseDeposit) revert Paused();
        uint256 amount = msg.value;
        uint256 totalValue = 0;
        uint256 priceBeforeDeposit = price();
        for (uint256 i = 0; i < strategies.length; i++) {
            AbstractErc20Strategy strategy = AbstractErc20Strategy(
                strategies[i].strategyAddress
            );
            if (strategies[i].ratio == 0) continue;
            uint256 mintAmount = strategy.deposit{
                value: (amount * strategies[i].ratio) / totalRatio
            }();
            totalValue += (mintAmount * strategy.price());
        }
        uint256 amountToMint = totalValue / priceBeforeDeposit;
        require(amountToMint >= _minout, "Slippage");
        _mint(msg.sender, amountToMint);
    }

    /**
        @notice - Request to close position
    */
    function requestWithdraw(
        uint256 _amount
    ) external virtual returns (uint256 withdrawId) {
        if (pauseWithdraw) revert Paused();
        latestWithdrawId++;

        uint256 withdrawRatio = (_amount * 1e18) / (totalSupply());

        _burn(msg.sender, _amount);

        withdrawIdInfo[latestWithdrawId].strategyWithdrawIds = new uint256[](
            strategies.length
        );
        for (uint256 i = 0; i < strategies.length; i++) {
            uint256 strategyBalance = ERC20Upgradeable(
                strategies[i].strategyAddress
            ).balanceOf(address(this));

            uint256 strategyWithdrawAmount = (withdrawRatio * strategyBalance) /
                1e18;
            uint256 strategyWithdrawId = AbstractErc20Strategy(
                strategies[i].strategyAddress
            ).requestWithdraw(strategyWithdrawAmount);
            withdrawIdInfo[latestWithdrawId].strategyWithdrawIds[
                i
            ] = strategyWithdrawId;
        }
        withdrawIdInfo[latestWithdrawId].owner = msg.sender;
        withdrawIdInfo[latestWithdrawId].amount = _amount;
        return latestWithdrawId;
    }

    function canWithdraw(uint256 withdrawId) public view returns (bool) {
        for (uint256 i = 0; i < strategies.length; i++) {
            if (
                !AbstractErc20Strategy(strategies[i].strategyAddress)
                    .canWithdraw(withdrawId)
            ) return false;
        }
        return true;
    }

    function withdrawTime(uint256 _amount) public view returns (uint256) {
        uint256 highestTime = 0;
        for (uint256 i = 0; i < strategies.length; i++) {
            uint256 time = AbstractErc20Strategy(strategies[i].strategyAddress)
                .withdrawTime(_amount);
            if (time > highestTime) highestTime = time;
        }
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
        uint256[] memory strategyWithdrawIds = withdrawIdInfo[_withdrawId]
            .strategyWithdrawIds;
        if (!canWithdraw(_withdrawId)) revert CanNotWithdraw();
        for (uint256 i = 0; i < strategyWithdrawIds.length; i++) {
            AbstractErc20Strategy strategy = AbstractErc20Strategy(
                strategies[i].strategyAddress
            );
            strategy.withdraw(strategyWithdrawIds[i]);
        }

        uint256 ethBalanceAfter = address(this).balance;
        uint256 ethReceived = ethBalanceAfter - ethBalanceBefore;

        require(ethReceived >= _minout, "Slippage");
        // solhint-disable-next-line
        (bool sent, ) = msg.sender.call{value: ethReceived}("");
        if (!sent) revert FailedToSend();
    }

    function depositRewards() external payable virtual {
        uint256 totalEthValue = (totalSupply() * price()) / 1e18;
        for (uint256 i; i < strategies.length; i++) {
            if (strategies[i].ratio == 0) continue;
            AbstractErc20Strategy strategy = AbstractErc20Strategy(
                strategies[i].strategyAddress
            );
            uint256 strategyEthValue = (strategy.price() *
                strategy.balanceOf(address(this))) / 1e18;
            uint256 strategyRatio = (strategies[i].ratio * 1e18) / totalRatio;
            // check if strategy is underweight or deposit if final iteration
            if (
                i == strategies.length - 1 ||
                (strategyEthValue * 1e18) / totalEthValue < strategyRatio
            ) {
                // apply reward here
                strategy.depositRewards(msg.value);
                break;
            }
        }
    }

    receive() external payable {}
}
