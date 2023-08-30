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

    error StrategyAlreadyAdded();
    error StrategyNotFound();
    error InsufficientBalance();
    error InvalidStrategy();

    uint256 latestWithdrawId;

    mapping(uint256 => uint256[]) public withdrawIdToStrategyWithdrawIds;

    mapping(uint256 => address) public withdrawIdOwners;

    modifier onlyWithdrawIdOwner(uint256 withdrawId) {
        require(
            withdrawIdOwners[withdrawId] == msg.sender,
            "Not withdrawId owner"
        );
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
        uint256 withdrawRatio = (amount * 1e18) / totalRatio;

        _transfer(msg.sender, address(this), amount);
        for (uint256 i = 0; i < strategies.length; i++) {
            uint256 strategyBalance = ERC20Upgradeable(
                strategies[i].strategyAddress
            ).balanceOf(address(this));
            uint256 strategyWithdrawAmount = (withdrawRatio * strategyBalance) /
                1e18;
            uint256 wid = AbstractErc20Strategy(strategies[i].strategyAddress)
                .requestWithdraw(strategyWithdrawAmount);
            withdrawIdToStrategyWithdrawIds[latestWithdrawId].push(wid);
        }
        withdrawIdOwners[latestWithdrawId] = msg.sender;
        return latestWithdrawId;
    }

    /**
        @notice - Withdraw from each strategy
    */
    function withdraw(
        uint256 withrawId
    ) external virtual onlyWithdrawIdOwner(withrawId) {
        uint256 ethBalanceBefore = address(this).balance;
        for (uint256 i = 0; i < strategies.length; i++) {
            uint256[]
                memory strategyWithdrawIds = withdrawIdToStrategyWithdrawIds[
                    withrawId
                ];
            for (uint256 j = 0; j < strategyWithdrawIds.length; j++) {
                AbstractErc20Strategy strategy = AbstractErc20Strategy(
                    strategies[i].strategyAddress
                );
                if (strategy.canWithdraw(strategyWithdrawIds[j])) {
                    strategy.withdraw(strategyWithdrawIds[j]);
                }
            }
        }
        uint256 ethBalanceAfter = address(this).balance;
        uint256 ethReceived = ethBalanceAfter - ethBalanceBefore;
        // solhint-disable-next-line
        (bool sent, ) = msg.sender.call{value: ethReceived}("");
        require(sent, "Failed to send Ether");
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
