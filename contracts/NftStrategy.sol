// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

abstract contract NftStrategy is Initializable, OwnableUpgradeable, ERC1155Upgradeable {
    /// open new position, returns positionId
    function mint() virtual external payable returns (uint256 positionCount);

    /// request to close a position
    function requestClose(uint256 positionId) virtual external;

    /// check if a position has fully closed and can be burned
    function burnable(uint256 positionId) virtual external view returns (uint256 burnable);

    /// burn token to claim eth if burnable(positionId) is true
    function burn(uint256 positionId) virtual external;

    /// Withdraw any rewards from the position that can be claimed
    function claimRewards(uint256 positionId) virtual external;

    /// how much rewards can be claimed right now
    function claimable(uint256 positionId) virtual external view returns (uint256 ethAmountClaimable);

    /// how much has already been claimed from a position
    function claimed(uint256 positionId) virtual external view returns (bool claimed);

    /// current value of a position if it were to be burned right now
    function currentValue(uint256 positionId) virtual external view returns (uint256 ethValue);
}
