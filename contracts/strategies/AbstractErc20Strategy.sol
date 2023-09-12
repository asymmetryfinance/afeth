// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

abstract contract AbstractErc20Strategy is
    Initializable,
    ReentrancyGuardUpgradeable,
    ERC20Upgradeable
{
    /// deposit into strategy
    function deposit(
        bool _shouldMint
    ) external payable virtual returns (uint256);

    /// request to unlock strategy
    /// not all strategies will need this, but will use this to keep a consistent interface
    function requestWithdraw(
        uint256 _amount
    ) external virtual returns (uint256 withdrawId);

    /// withdraw out of strategy
    function withdraw(uint256 withdrawId) external virtual;

    // checks if a withdraw request can be withdrawn
    function canWithdraw(
        uint256 withdrawId
    ) external view virtual returns (bool);

    // gets price of strategy in eth
    function price() external view virtual returns (uint256);

    function withdrawTime(
        uint256 _amount
    ) external view virtual returns (uint256);
}
