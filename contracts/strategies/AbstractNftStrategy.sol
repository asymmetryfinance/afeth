// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

abstract contract AbstractNftStrategy is Initializable, OwnableUpgradeable {
    struct Position {
        uint256 unlockTime; // when it can be burned (fully closed). 0 if requestClose() hasn't been called
        uint256 ethClaimed; // how much eth value has been claimed from this position so far
        uint256 ethBurned; // how much eth was received by burning tokens from this position
        uint256 startingValue; // how much eth value was locked up when the position was created
        address owner; // address of who owns the position
    }

    uint256 public positionCount;
    mapping(uint => Position) public positions;

    /// open new position (mint nft), returns positionId
    function mint(
        uint256 _positionId,
        address _msgSender
    ) external payable virtual;

    /// request to close a position so nft can be burned later
    function requestClose(
        uint256 _positionId,
        address _msgSender
    ) external virtual;

    /// burn nft to receive all locked value and rewards. position must be fully closed (requestClose() called & sufficient time passed)
    function burn(uint256 _positionId, address _msgSender) external virtual;

    /// Withdraw any rewards from the position that can be claimed right now
    function claimRewards(uint256 _positionId) external virtual;

    /// how much rewards can be claimed right now
    function claimableNow(
        uint256 _positionId
    ) external view virtual returns (uint256 ethAmountClaimable);

    /// how much eth value is locked up
    function lockedValue(
        uint256 _positionId
    ) external view virtual returns (uint256 ethValue);
}
