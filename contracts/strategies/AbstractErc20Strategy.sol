// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

abstract contract AbstractErc20Strategy is
    Initializable,
    ReentrancyGuardUpgradeable
{
    /// deposit into strategy
    function deposit() external payable virtual returns (uint256);

    /// request to unlock strategy
    /// not all strategies will need this, but will use this to keep a consistent interface
    function requestWithdraw(
        uint256 _amount
    ) external virtual returns (uint256);

    /// withdraw out of strategy
    function withdraw(uint256) external virtual;

    function price() external virtual returns (uint256);
}
