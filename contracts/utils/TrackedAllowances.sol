// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

struct Allowance {
    address spender;
    address token;
}

/**
 * @author philogy <https://github.com/philogy>
 * @dev Tracks the list of addresses that have received an allowance from this contract
 */
abstract contract TrackedAllowances {
    using EnumerableSet for EnumerableSet.Bytes32Set;
    using SafeTransferLib for address;

    /**
     * @dev While using extra gas, the enumerable set allows all allowances to be enumerated
     * atomatically without relying on any additional indexing or log querying. This can be
     * particularly useful in emergencies when allowances need to be revoked en-mass with minimal
     * effort.
     */
    EnumerableSet.Bytes32Set internal allowanceKeys;
    mapping(bytes32 => Allowance) internal allowances;

    function _emergencyRevokeAllAllowances() internal {
        uint256 totalAllowances = allowanceKeys.length();
        for (uint256 i = 0; i < totalAllowances; i++) {
            bytes32 allowanceKey = allowanceKeys.at(i);
            Allowance storage allowance = allowances[allowanceKey];
            allowance.token.safeApproveWithRetry(allowance.spender, 0);
        }
        // Could remove keys now that allowance is revoked but want to reduce gas to be spend in
        // emergencies.
    }

    function _revokeSingleAllowance(Allowance memory allowance) internal {
        bytes32 allowanceKey = _allowanceKey(allowance);
        allowanceKeys.remove(allowanceKey);
        allowance.token.safeApproveWithRetry(allowance.spender, 0);
    }

    function _grantAndTrackInfiniteAllowance(Allowance memory allowance) internal {
        bytes32 allowanceKey = _allowanceKey(allowance);
        allowanceKeys.add(allowanceKey);
        allowances[allowanceKey] = allowance;
        allowance.token.safeApproveWithRetry(allowance.spender, type(uint256).max);
    }

    function _allowanceKey(Allowance memory allowance) internal pure returns (bytes32) {
        return keccak256(abi.encode(allowance));
    }
}
