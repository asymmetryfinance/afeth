// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/// @author philogy <https://github.com/philogy>
interface IProxySource {
    function implementation() external view returns (address);
}
