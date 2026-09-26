import { parseAbi } from "viem";

export const vaultEventAbi = parseAbi([
  "event Deposit(address indexed user, address indexed token, uint256 amount, address indexed onBehalfOf, uint256 received)",
  "event Withdraw(address indexed operator, address indexed user, address indexed token, uint256 amount, address to)",
  "event Withdraw(address indexed operator, address indexed user, address indexed token, uint256 amount, address to, uint256 received)",
  "event Seize(address indexed from, address indexed to, address indexed token, uint256 amount)",
  "event ExternalCredit(address indexed pool, address indexed user, address indexed token, uint256 amount)",
  "event PnLSettled(address indexed user, address indexed token, int256 amount)",
]);

export const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

export const vaultReadAbi = parseAbi([
  "function balanceOf(address user, address token) view returns (uint256)",
  "function userBalances(address user, address token) view returns (uint256)",
  "function totalOf(address token) view returns (uint256)",
]);
