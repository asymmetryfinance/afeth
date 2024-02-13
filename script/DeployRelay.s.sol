// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import {Script} from "forge-std/Script.sol";
import {Test} from "forge-std/Test.sol";
import {ERC1967FactoryConstants} from "solady/src/utils/ERC1967FactoryConstants.sol";
import {ERC1967Factory} from "solady/src/utils/ERC1967Factory.sol";
import {AfEthRelayer} from "../src/AfEthRelayer.sol";
import {console2 as console} from "forge-std/console2.sol";

/// @author philogy <https://github.com/philogy>
contract DeployRelayScript is Test, Script {
    bytes32 internal constant AF_ETH_VANITY_SALT = 0x67b80ff33e5937b58b2a46870a912cb11d231efbec654a8355b46947ec1a0010;
    bytes32 internal constant VOTIUM_VANITY_SALT = 0x67b80ff33e5937b58b2a46870a912cb11d231efbf13066ae7fad3ff30a060010;

    bytes32 internal constant RELAY_VANITY_SALT = 0x67b80ff33e5937b58b2a46870a912cb11d231efbbab440b5457a1800089dc6c5;

    function run() public {
        ERC1967Factory factory = ERC1967Factory(ERC1967FactoryConstants.ADDRESS);

        address OWNER = 0x263b03BbA0BbbC320928B6026f5eAAFAD9F1ddeb;

        // TODO: Not the recommended way of loading private key.
        uint256 pk = vm.envUint("PRIV_KEY");

        vm.startBroadcast(pk);

        address relayImplementation = address(new AfEthRelayer());

        address relay = factory.deployDeterministicAndCall(
            relayImplementation,
            OWNER,
            RELAY_VANITY_SALT,
            abi.encodeCall(AfEthRelayer.initialize, ())
        );


        console.log("relay successfuly deployed at %s", relay);

        vm.stopBroadcast();
    }
}
