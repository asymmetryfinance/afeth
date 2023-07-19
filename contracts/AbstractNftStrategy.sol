// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
import "@openzeppelin/contracts-upgradeable/token/ERC721/ERC721Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

abstract contract AbstractNftStrategy is Initializable, OwnableUpgradeable, ERC721Upgradeable {
    struct Position {
        uint256 unlockTime; // when it can be burned. 0 if requestClose() hasn't been called
        uint256 ethClaimed; // how much eth value has been claimed from this position so far
        uint256 ethBurned; // how much eth was received by burning tokens from this position
        uint256 startingValue; // how much eth value was locked up when the position was created
    }

    uint256 public positionCount;
    mapping(uint => Position) public positions;

    modifier onlyPositionOwner(uint256 positionId) {
        require(ownerOf(positionId) == msg.sender, "Not owner");
        _;
    }

    /// open new position, returns positionId
    function mint() virtual external payable returns (uint256 positionId);

    /// request to close a position so it can be burned later
    function requestClose(uint256 positionId) virtual external;

    /// burn token to receive all locked value and rewards (position must be fully closed)
    function burn(uint256 positionId) virtual external;

    /// Withdraw any rewards from the position that can be claimed right now
    function claimRewards(uint256 positionId) virtual external;

    /// how much rewards can be claimed right now
    function claimableNow(uint256 positionId) virtual external view returns (uint256 ethAmountClaimable);

    /// how much eth value is locked up
    function lockedValue(uint256 positionId) virtual external view returns (uint256 ethValue);
}
