// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @dev Derived via `keccak256("eip1967.proxy.implementation") - 1`.
uint256 constant ERC1967_IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

/// @author philogy <https://github.com/philogy>
abstract contract ERC1967 {
    event Upgraded(address indexed implementation);

    error InitializationCallFailed();

    struct _ERC1967Slot {
        address implementation;
        uint96 ___extraData;
    }

    function _upgradeTo(address newImplementation, bytes memory data) internal {
        _ERC1967Slot storage erc1967Slot;
        /// @solidity memory-safe-assembly
        assembly {
            erc1967Slot.slot := ERC1967_IMPL_SLOT
        }
        erc1967Slot.implementation = newImplementation;
        (bool success,) = newImplementation.delegatecall(data);
        if (!success) revert InitializationCallFailed();
        emit Upgraded(newImplementation);
    }
}
