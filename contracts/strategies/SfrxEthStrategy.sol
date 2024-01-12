// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.19;

import {SafeTransferLib} from "solady/src/utils/SafeTransferLib.sol";
import {FixedPointMathLib} from "solady/src/utils/FixedPointMathLib.sol";
import {FRX_ETH_POOL, ETH_COIN_INDEX, FRX_ETH_COIN_INDEX} from "../interfaces/frax/IFrxEthPool.sol";
import {FRAX_ETH_MINTER} from "../interfaces/frax/IFraxEthMinter.sol";
import {SFRX_ETH} from "../interfaces/frax/ISfrxETH.sol";
import {FRX_ETH} from "../interfaces/frax/frxETH.sol";

/**
 * @author philogy <https://github.com/philogy>
 * @dev Strategy written as library so that code is inlined. Strategy doesn't have to be modularly
 * swappable because main contract (afETH) is upgradeable.
 */
library SfrxEthStrategy {
    using FixedPointMathLib for uint256;
    using SafeTransferLib for address;

    uint256 internal constant MIN_WITHDRAW_OUT_SHARE = 0.98e18; // 98%

    struct Storage {
        uint256 totalBalance;
    }

    /// @dev keccak256("af-eth.sfrx-eth-strategy.storage")
    uint256 internal constant BASE_SLOT = 0x32dc96791416fa9ff024fb4392a7e2130e320ad41ea55b8e4884f2b9235ba9ba;

    error UnexpectedExhangeError();

    function init() internal {
        FRX_ETH.safeApproveWithRetry(address(SFRX_ETH), type(uint256).max);
        FRX_ETH.safeApproveWithRetry(address(FRX_ETH_POOL), type(uint256).max);
    }

    function ethSfrxPrice() internal view returns (uint256) {
        // pricePerShare() -> price in frxETH / sfrxETH
        // ethPerFrxEthPrice() -> price in ETH / frxETH
        // multiplied together -> ETH / sfrxETH
        return SFRX_ETH.pricePerShare().mulWad(ethPerFrxEthPrice());
    }

    function totalEthValue() internal view returns (uint256 value, uint256 price) {
        price = ethSfrxPrice();
        value = availableBalance().mulWad(price);
    }

    function deposit(uint256 value) internal returns (uint256 shares) {
        if (value == 0) return 0;
        // Checks against the pool to see if frxETH can be acquired at a price better than 1:1
        try FRX_ETH_POOL.exchange{value: value}(ETH_COIN_INDEX, FRX_ETH_COIN_INDEX, value, value) returns (
            uint256 betterValue
        ) {
            value = betterValue;
        } catch Error(string memory reason) {
            if (
                keccak256(abi.encodePacked(reason))
                    != keccak256(abi.encodePacked("Exchange resulted in fewer coins than expected"))
            ) revert UnexpectedExhangeError();

            address(FRAX_ETH_MINTER).safeTransferETH(value);
        }
        shares = SFRX_ETH.deposit(value, address(this));
    }

    function withdraw(uint256 withdrawShare) internal returns (uint256 ethOut) {
        uint256 sfrxEthAmount = availableBalance().mulWad(withdrawShare);
        uint256 frxEthAmount = SFRX_ETH.redeem(sfrxEthAmount, address(this), address(this));
        ethOut = _unsafeSellFrxEth(frxEthAmount);
    }

    function withdrawEth(uint256 ethAmount) internal returns (uint256 ethOut, uint256 sfrxEthRedeemd) {
        uint256 frxEthAmount = ethAmount.divWad(FRX_ETH_POOL.get_p());
        sfrxEthRedeemd = SFRX_ETH.withdraw(frxEthAmount, address(this), address(this));
        ethOut = _unsafeSellFrxEth(frxEthAmount);
    }

    function ethPerFrxEthPrice() internal view returns (uint256) {
        return FRX_ETH_POOL.price_oracle();
    }

    function availableBalance() internal view returns (uint256) {
        return SFRX_ETH.balanceOf(address(this));
    }

    function _unsafeSellFrxEth(uint256 frxEthAmount) internal returns (uint256 ethOut) {
        ethOut = FRX_ETH_POOL.exchange(FRX_ETH_COIN_INDEX, ETH_COIN_INDEX, frxEthAmount, 0);
    }

    function store() internal pure returns (Storage storage s) {
        /// @solidity memory-safe-assembly
        assembly {
            s.slot := BASE_SLOT
        }
    }
}
