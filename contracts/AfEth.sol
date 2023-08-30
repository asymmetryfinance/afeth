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
    uint256 totalRatio;

    struct RequestWithdrawPosition {
        uint256 afEthOwed; // how much cvxOwed total is owed for this position
        uint256 timestamp; // timestamp when available to withdraw from all strategies
    }
    mapping(address => RequestWithdrawPosition[])
        public requestWithdrawPositions;

    error StrategyAlreadyAdded();
    error StrategyNotFound();
    error InsufficientBalance();

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
        @param _strategy - Address of the strategy contract
        @param _ratio - Ratio for the strategy
    */
    function addStrategy(address _strategy, uint256 _ratio) external onlyOwner {
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
        totalRatio = total;
    }

    /**
        @notice - Add strategies to the strategies array
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
    function requestWithdraw() external virtual {
        uint256 amount = balanceOf(msg.sender);
        _transfer(msg.sender, address(this), amount);
        uint256 timestamp = block.timestamp;
        for (uint256 i = 0; i < strategies.length; i++) {
            uint256 strategyTimestamp = AbstractErc20Strategy(
                strategies[i].strategyAddress
            ).requestWithdraw(amount);
            if (strategyTimestamp > timestamp) {
                timestamp = strategyTimestamp;
            }
        }
        requestWithdrawPositions[msg.sender].push(
            RequestWithdrawPosition(amount, timestamp)
        );
    }

    /**
        @notice - Withdraw from each strategy
    */
    function withdraw() external virtual {
        // uint256 ethBalanceBefore = address(this).balance;
        // for (uint256 i = 0; i < strategies.length; i++) {
        //     AbstractNftStrategy strategy = AbstractNftStrategy(strategies[i]);
        //     strategy.burn(_positionId);
        // }
        // _burn(_positionId);
        // uint256 ethBalanceAfter = address(this).balance;
        // uint256 ethReceived = ethBalanceAfter - ethBalanceBefore;
        // // solhint-disable-next-line
        // (bool sent, ) = msg.sender.call{value: ethReceived}("");
        // require(sent, "Failed to send Ether");
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
