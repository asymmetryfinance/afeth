import "./SafEthStrategyCore.sol";
import "../../NftStrategy.sol";

// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

contract SafEthNft is NftStrategy, SafEthStrategyCore {
    // how many individual tokens to mint per erc1155 position
    uint256 public positionDivisibility = 10e18;

    function mint() external payable override returns (uint256) {
        positions[positionCount] = Position(0, 0, 0, 0, 0, 0);
        _mint(msg.sender, positionCount, positionDivisibility, "");
        positionCount++;
        return positionCount;
    }

    function requestClose(uint256 positionId) external override {
        positions[positionId] = Position(0, 0, 0, 0, 0, 0);
    }

    function burn(uint256 positionId) external override {
        _burn(msg.sender, positionId, balanceOf(msg.sender, positionId));
    }

    function claimRewards(uint256 positionId) external override {
        require (this.claimableNow(positionId) > 0, "nothing to claim");
    }

    function claimableNow(
        uint256 positionId
    ) external view override returns (uint256 ethAmount) {
        return 0;
    }

    function lockedValue(
        uint256 positionId
    ) external view override returns (uint256 ethValue) {
        return 0;
    }
}
