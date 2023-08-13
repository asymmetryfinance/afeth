// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../../external_interfaces/IWETH.sol";
import "../../external_interfaces/ISwapRouter.sol";
import "../../external_interfaces/IVotiumMerkleStash.sol";
import "../../external_interfaces/ISnapshotDelegationRegistry.sol";
import "../../external_interfaces/ILockedCvx.sol";
import "../../external_interfaces/IClaimZap.sol";
import "../../external_interfaces/ICrvEthPool.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "hardhat/console.sol";

contract RebaseableErc20 is IERC20 {
    uint256 supply;
    uint256 rebaseRatio;
    mapping(address => uint256) public rebaseRewardsWithdrawn;
    mapping(address => uint256) public balances;
    mapping (address => mapping (address => uint256)) allowed;

    function totalSupply() public view returns (uint256) {
        uint256 rebasedTotalSupply = (supply * rebaseRatio) / 1e18;
        return rebasedTotalSupply;
    }

    function balanceOf(address _account) public view returns (uint256) {
        uint256 rebasedBalance = (balances[_account] * rebaseRatio) / 1e18;
        return rebasedBalance;
    }

    function _mint(address _recipient, uint256 _amount)
        public
        returns (bool)
    {
        uint256 rebasedAmount = ((_amount * 1e18) / rebaseRatio);
        supply += rebasedAmount;
        balances[_recipient] += rebasedAmount;
        emit Transfer(address(0), _recipient, _amount);
        return true;
    }

    function _burn(address _account, uint256 _amount)
        public
        returns (bool)
    {
        uint256 rebasedAmount = ((_amount * 1e18) / rebaseRatio);
        supply -= rebasedAmount;
        balances[_account] -= rebasedAmount;
        emit Transfer(_account, address(0), _amount);
        return true;
    }

    function transfer(address _recipient, uint256 _amount)
        public
        returns (bool)
    {
        uint256 rebasedAmount = ((_amount * 1e18) / rebaseRatio);
        balances[msg.sender] -= rebasedAmount;
        balances[_recipient] += rebasedAmount;
        emit Transfer(msg.sender, _recipient, _amount);
        return true;
    }

    function transferFrom(
        address _sender,
        address _recipient,
        uint256 _amount
    ) public returns (bool) {
        uint256 rebasedAmount = ((_amount * 1e18) / rebaseRatio);
        balances[_sender] -= rebasedAmount;
        balances[_recipient] += rebasedAmount;
        emit Transfer(_sender, _recipient, _amount);
        return true;
    }

    function approve(address _spender, uint256 _value) public returns (bool success) {
        allowed[msg.sender][_spender] = _value;
        emit Approval(msg.sender, _spender, _value);
        return true;
    }

    function allowance(address _owner, address _spender) public view returns (uint256 remaining) {
      return allowed[_owner][_spender];
    }

    function initializeRebaseable() external {
        rebaseRatio = 1e18;
    }
}
