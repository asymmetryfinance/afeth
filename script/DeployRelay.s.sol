// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script} from "forge-std/Script.sol";
import {Test} from "forge-std/Test.sol";
import {AfEthRelayer} from "../src/AfEthRelayer.sol";
import {SimpleProxyFactory} from "../src/utils/SimpleProxyFactory.sol";
import {console2 as console} from "forge-std/console2.sol";

/// @author philogy <https://github.com/philogy>
contract DeployRelayScript is Test, Script {
    bytes32 internal constant RELAY_VANITY_SALT = 0x67b80ff33e5937b58b2a46870a912cb11d231efb29d74144d35e2000083bf82a;

    function run() public {
        SimpleProxyFactory factory = SimpleProxyFactory(0x51fBA11386fb26Ae017D539624435137a25d7CE9);

        address OWNER = 0x263b03BbA0BbbC320928B6026f5eAAFAD9F1ddeb;

        // TODO: Not the recommended way of loading private key.
        uint256 pk = vm.envUint("PRIV_KEY");

        vm.startBroadcast(pk);

        address relayImplementation = address(new AfEthRelayer());

        address relay = factory.deployDeterministic(
            RELAY_VANITY_SALT, relayImplementation, abi.encodeCall(AfEthRelayer.initialize, (OWNER))
        );

        console.log("relay successfuly deployed at %s", relay);

        vm.stopBroadcast();
    }
}
