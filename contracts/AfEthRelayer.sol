// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./external_interfaces/IAfEth.sol";
import "./external_interfaces/IWETH.sol";
import "contracts/external_interfaces/ISafEth.sol";
import "contracts/strategies/AbstractStrategy.sol";
import "hardhat/console.sol";

// AfEth is the strategy manager for safEth and votium strategies
contract AfEthRelayer is Initializable {
    address public constant SAF_ETH_ADDRESS =
        0x6732Efaf6f39926346BeF8b821a04B6361C4F3e5;
    address public constant AF_ETH_ADDRESS =
        0x5F10B16F0959AaC2E33bEdc9b0A4229Bb9a83590;
    address public constant WETH_ADDRESS =
        0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;

    // As recommended by https://docs.openzeppelin.com/upgrades-plugins/1.x/writing-upgradeable
    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
        @notice - Initialize values for the contracts
        @dev - This replaces the constructor for upgradeable contracts
    */
    function initialize() external initializer {}

    // Swaps ERC20->ERC20 tokens held by this contract using a 0x-API quote.
    function fillQuote(
        // The `sellTokenAddress` field from the API response.
        IERC20 sellToken,
        // The `buyTokenAddress` field from the API response.
        IERC20 buyToken,
        // The `allowanceTarget` field from the API response.
        address spender,
        // The `to` field from the API response.
        address payable swapTarget,
        // The `data` field from the API response.
        bytes calldata swapCallData
    ) public payable {
        // ...

        // Give `spender` an infinite allowance to spend this contract's `sellToken`.
        // Note that for some tokens (e.g., USDT, KNC), you must first reset any existing
        // allowance to 0 before being able to update it.
        require(sellToken.approve(spender, type(uint256).max), "Approve Failed");
        // Call the encoded swap function call on the contract at `swapTarget`,
        // passing along any ETH attached to this function call to cover protocol fees.
        (bool success, ) = swapTarget.call{value: msg.value}(swapCallData);
        require(success, "Swap Failed");

        // Refund any unspent protocol fees to the sender.
        // msg.sender.transfer(address(this).balance);
    }

    /**
        @notice - Deposits into the SafEth contract and relay to owner address
        @param _minout - Minimum amount of SafEth to mint
        @param _owner - Owner of the SafEth
    */
    function depositSafEth(
        uint256 _minout,
        address _owner,
        address _sellToken,
        address _allowanceTarget,
        address payable _to,
        bytes calldata _swapCallData
    ) external payable virtual {
        fillQuote(IERC20(_sellToken), IERC20(WETH_ADDRESS), _allowanceTarget, _to, _swapCallData);
        // IWETH(WETH_ADDRESS).withdraw(amount);
        uint256 beforeDeposit = IERC20(SAF_ETH_ADDRESS).balanceOf(
            address(this)
        );
        ISafEth(SAF_ETH_ADDRESS).stake{value: msg.value}(_minout);
        uint256 amountToTransfer = IERC20(SAF_ETH_ADDRESS).balanceOf(
            address(this)
        ) - beforeDeposit;
        console.log("AMOUNT TO TRANSFER", amountToTransfer);
        IERC20(SAF_ETH_ADDRESS).transfer(_owner, amountToTransfer);
    }

    /**
        @notice - Deposits into the AfEth contract and relay to owner address
        @param _minout - Minimum amount of AfEth to mint
        @param _deadline - Time before transaction expires
        @param _owner - Owner of the AfEth
    */
    function depositAfEth(
        uint256 _minout,
        uint256 _deadline,
        address _owner
    ) external payable virtual {
        uint256 beforeDeposit = IERC20(AF_ETH_ADDRESS).balanceOf(address(this));
        IAfEth(AF_ETH_ADDRESS).deposit{value: msg.value}(_minout, _deadline);
        uint256 amountToTransfer = IERC20(AF_ETH_ADDRESS).balanceOf(
            address(this)
        ) - beforeDeposit;
        IERC20(AF_ETH_ADDRESS).transfer(_owner, amountToTransfer);
    }
}
