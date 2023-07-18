// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC1155/ERC1155Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

/// Handles logic related to locking and unlocking the underlying cvx
contract VotiumVlcvxManager {
    // last epoch in which relock was called
    uint256 public lastRelockEpoch;

    // cvx amount we cant relock because users have closed the positions and can now withdraw
    uint256 public cvxToLeaveUnlocked;

    struct VlCvxPosition {
        address owner;
        uint256 cvxAmount; // amount of cvx locked in this position
        uint256 unlockEpoch; // when they are expected to be able to withdraw (if relockCvx has been called)
    }
}
