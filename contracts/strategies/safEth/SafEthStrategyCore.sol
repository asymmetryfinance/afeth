// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// For private internal functions and anything not exposed via the interface
contract SafEthStrategyCore is
    Initializable,
    OwnableUpgradeable,
    ERC721Upgradeable
{
    address public constant safEthAddress =
        0x6732Efaf6f39926346BeF8b821a04B6361C4F3e5;

    struct SafEthPosition {
        uint256 safEthAmount; // amount of safEth in this position
    }

    mapping(uint256 => SafEthPosition) public safEthPositions;

    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
        @notice - Function to initialize values for the contracts
        @dev - This replaces the constructor for upgradeable contracts
        @param _manager - Address of the manager contract
    */
    function initialize(address _manager) external initializer {
        _transferOwnership(_manager);
    }

    receive() external payable {}
}
