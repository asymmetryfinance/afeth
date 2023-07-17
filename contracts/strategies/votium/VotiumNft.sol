import "./VotiumStrategyCore.sol";
import "../../NftStrategy.sol";

// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

contract VotiumStrategy is VotiumStrategyCore, NftStrategy {
    // how many individual tokens to mint per erc1155 position
    uint256 public positionDivisibility = 10e18;

    // total positions that have ever been created
    uint256 public positionCount;

    function mint() external payable override returns (uint256) {
        _mint(msg.sender, positionCount, positionDivisibility, "");
        positionCount++;
        return positionCount;
    }

    function requestClose(uint256 positionId) external override {}

    function burnable(
        uint256 positionId
    ) external view override returns (uint256) {}

    function burn(uint256 positionId) external override {}

    function claimRewards(uint256 positionId) external override {}

    function claimable(
        uint256 positionId
    ) external view override returns (uint256 ethAmount) {}

    function claimed(
        uint256 positionId
    ) external view override returns (bool hasClaimed) {}

    function currentValue(
        uint256 positionId
    ) external view override returns (uint256 ethValue) {}
}
