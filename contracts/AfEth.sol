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

    error StrategyAlreadyAdded();
    error StrategyNotFound();
    error InsufficientBalance();
    error InvalidStrategy();
    error CanNotWithdraw();
    error NotOwner();
    error FailedToSend();

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
        @notice - Deposits into each strategy
        @dev - This is the entry into the protocol
    */
    function deposit() external payable virtual {
        uint256 amount = msg.value;
        uint256 amountToMint = 0;
        for (uint256 i = 0; i < strategies.length; i++) {
            AbstractErc20Strategy strategy = AbstractErc20Strategy(
                strategies[i].strategyAddress
            );
            if (strategies[i].ratio == 0) continue;
            uint256 mintAmount = strategy.deposit{
                value: (amount * strategies[i].ratio) / totalRatio
            }();
            amountToMint += (mintAmount * strategy.price()) / 1e18;
        }
        _mint(msg.sender, amountToMint);
    }

    /**
        @notice - Request to close position
    */
    function requestWithdraw() external virtual returns (uint256 withdrawId) {
        latestWithdrawId++;
        uint256 amount = balanceOf(msg.sender);

        // ratio of afEth being withdrawn to totalSupply
        uint256 withdrawRatio = (amount * 1e18) / totalSupply();

        _transfer(msg.sender, address(this), amount);
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
        withdrawIdInfo[latestWithdrawId].amount = amount;
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

    /**
        @notice - Withdraw from each strategy
    */
    function withdraw(
        uint256 withdrawId
    ) external virtual onlyWithdrawIdOwner(withdrawId) {
        uint256 ethBalanceBefore = address(this).balance;
        uint256[] memory strategyWithdrawIds = withdrawIdInfo[withdrawId]
            .strategyWithdrawIds;
        if (!canWithdraw(withdrawId)) revert CanNotWithdraw();
        for (uint256 i = 0; i < strategyWithdrawIds.length; i++) {
            AbstractErc20Strategy strategy = AbstractErc20Strategy(
                strategies[i].strategyAddress
            );
            strategy.withdraw(strategyWithdrawIds[i]);
        }

        _burn(address(this), withdrawIdInfo[withdrawId].amount);
        uint256 ethBalanceAfter = address(this).balance;
        uint256 ethReceived = ethBalanceAfter - ethBalanceBefore;
        console.log("ETH Received: ", ethReceived);

        // solhint-disable-next-line
        (bool sent, ) = msg.sender.call{value: ethReceived}("");
        if (!sent) revert FailedToSend();
    }

    // deposit value to safEth side
    function applySafEthReward() public payable {
        // TODO mint msg.value of safEth strategy tokens
    }

    // deposit value to votium side
    function applyVotiumReward() public payable {
        // TODO mint msg.value to votium strategy tokens
    }

    receive() external payable {}
}
