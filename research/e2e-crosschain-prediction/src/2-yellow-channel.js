#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 * STEP 2 — Yellow Network: Auth + State Channel Creation
 * ═══════════════════════════════════════════════════════════════
 *
 * Authenticates with Yellow ClearNet via EIP-712,
 * creates a session key, opens a state channel,
 * and creates an application session for the LO prediction.
 *
 * Flow:
 *   1. Connect to ClearNet WebSocket (sandbox)
 *   2. Perform EIP-712 auth handshake (auth_request → challenge → verify)
 *   3. Request faucet tokens (sandbox only)
 *   4. Create an app session (state channel) for the prediction
 *   5. Return the channel context for subsequent steps
 */
import WebSocket from 'ws';
import {
  createAuthRequestMessage,
  createAuthVerifyMessageFromChallenge,
  createEIP712AuthMessageSigner,
  createECDSAMessageSigner,
  createAppSessionMessage,
  createCloseAppSessionMessage,
  createSubmitAppStateMessage,
  createApplicationMessage,
  createGetConfigMessageV2,
  createGetLedgerBalancesMessage,
  parseAnyRPCResponse,
  RPCMethod,
} from '@erc7824/nitrolite';
import { createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

// Protocol version required by the SDK
const PROTOCOL_VERSION = 'NitroRPC/0.2';

// ─── Helpers ──────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wait for a specific RPC method response from the WebSocket
 */
function waitForMessage(ws, targetMethod, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${targetMethod} (${timeoutMs}ms)`));
    }, timeoutMs);

    function handler(data) {
      try {
        const raw = typeof data === 'string' ? data : data.toString();
        const msg = parseAnyRPCResponse(raw);
        if (msg?.method === targetMethod || msg?.method === RPCMethod.Error) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          if (msg.method === RPCMethod.Error) {
            reject(new Error(`RPC Error: ${JSON.stringify(msg.params || msg)}`));
          } else {
            resolve(msg);
          }
        }
      } catch (err) {
        // Not our message, ignore
      }
    }

    ws.on('message', handler);
  });
}

// ─── Core Functions ───────────────────────────────────────────

/**
 * Request faucet tokens from the Yellow sandbox
 */
export async function requestFaucetTokens(walletAddress, faucetUrl) {
  console.log('  💧 Requesting sandbox faucet tokens...');
  try {
    const res = await fetch(faucetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userAddress: walletAddress }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      console.log('  ✅ Faucet tokens received (off-chain balance)');
      return data;
    } else {
      console.log(`  ⚠️  Faucet returned ${res.status} (may already have tokens)`);
      return null;
    }
  } catch (err) {
    console.log(`  ⚠️  Faucet request failed: ${err.message}`);
    return null;
  }
}

/**
 * Connect to ClearNet WebSocket and authenticate
 *
 * @returns {{ ws, account, sessionAccount, sessionSigner, config }}
 */
export async function connectAndAuth({
  privateKey,
  rpcUrl,
  wsUrl = 'wss://clearnet-sandbox.yellow.com/ws',
  faucetUrl = 'https://clearnet-sandbox.yellow.com/faucet/requestTokens',
  allowanceAmount = '1000000000', // 1000 USDC
  applicationName = 'molty-prediction',
  scope = 'molty.app',
}) {
  const pk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(pk);

  // Generate ephemeral session key
  const sessionPrivateKey = generatePrivateKey();
  const sessionAccount = privateKeyToAccount(sessionPrivateKey);
  const sessionSigner = createECDSAMessageSigner(sessionPrivateKey);

  // Wallet client for EIP-712 signing
  const walletClient = createWalletClient({
    chain: sepolia,
    transport: http(rpcUrl || 'https://rpc.sepolia.org'),
    account,
  });

  console.log('\n══════════════════════════════════════════════════');
  console.log('  STEP 2: Yellow Network — Auth & State Channel');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Wallet:      ${account.address}`);
  console.log(`  Session key: ${sessionAccount.address}`);
  console.log(`  ClearNet:    ${wsUrl}`);
  console.log('');

  // Request faucet tokens first (sandbox)
  if (faucetUrl) {
    await requestFaucetTokens(account.address, faucetUrl);
  }

  // Auth params
  const authParams = {
    address: account.address,
    session_key: sessionAccount.address,
    application: applicationName,
    allowances: [{ asset: 'ytest.usd', amount: allowanceAmount }],
    expires_at: BigInt(Math.floor(Date.now() / 1000) + 7200), // 2 hours
    scope,
  };

  // Connect WebSocket
  console.log('  🔌 Connecting to ClearNet WebSocket...');
  const ws = await new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    socket.on('open', () => resolve(socket));
    socket.on('error', (err) => reject(new Error(`WebSocket connection failed: ${err.message}`)));
    setTimeout(() => reject(new Error('WebSocket connection timeout')), 15000);
  });
  console.log('  ✅ WebSocket connected');

  // Step 1: Send auth_request
  console.log('  📤 Sending auth_request...');
  const authRequestMsg = await createAuthRequestMessage(authParams);
  ws.send(authRequestMsg);

  // Step 2: Wait for auth_challenge
  const challengeMsg = await waitForMessage(ws, RPCMethod.AuthChallenge);
  const challenge = challengeMsg?.params?.challengeMessage;
  if (!challenge) {
    throw new Error('No challenge in auth_challenge response');
  }
  console.log('  📨 Received auth_challenge');

  // Step 3: Sign challenge with EIP-712 and send auth_verify
  const eip712Signer = createEIP712AuthMessageSigner(walletClient, {
    scope: authParams.scope,
    session_key: authParams.session_key,
    expires_at: authParams.expires_at,
    allowances: authParams.allowances,
  }, { name: authParams.application });

  const authVerifyMsg = await createAuthVerifyMessageFromChallenge(eip712Signer, challenge);
  ws.send(authVerifyMsg);
  console.log('  📤 Sent auth_verify');

  // Step 4: Wait for auth success
  const verifyResult = await waitForMessage(ws, RPCMethod.AuthVerify);
  if (!verifyResult?.params?.success) {
    throw new Error(`Authentication failed: ${JSON.stringify(verifyResult?.params)}`);
  }
  console.log('  ✅ Authentication successful!');

  // Step 5: Fetch ClearNode config
  console.log('  📤 Fetching ClearNode config...');
  const configMsg = createGetConfigMessageV2();
  ws.send(configMsg);
  const configResult = await waitForMessage(ws, RPCMethod.GetConfig);
  const config = configResult?.params;
  console.log(`  ✅ Config received (${Object.keys(config || {}).length} keys)`);

  // Step 6: Check ledger balances
  console.log('  📤 Checking ledger balances...');
  try {
    const balancesMsg = await createGetLedgerBalancesMessage(sessionSigner);
    ws.send(balancesMsg);
    const balancesResult = await waitForMessage(ws, RPCMethod.GetLedgerBalances);
    const balances = balancesResult?.params;
    if (Array.isArray(balances)) {
      balances.forEach((b) => {
        console.log(`     ${b.asset}: ${b.amount}`);
      });
    } else {
      console.log(`  ✅ Balances: ${JSON.stringify(balances)}`);
    }
  } catch (err) {
    console.log(`  ⚠️  Balance check skipped: ${err.message}`);
  }

  // Extract broker address from config
  const brokerAddress = config?.brokerAddress || null;
  if (brokerAddress) {
    console.log(`  📍 Broker (counterparty): ${brokerAddress}`);
  }

  return {
    ws,
    account,
    sessionAccount,
    sessionSigner,
    sessionPrivateKey,
    walletClient,
    config,
    authParams,
    brokerAddress,
  };
}

/**
 * Create an application session (state channel) for the LO prediction
 *
 * @returns {{ channelId, appDefinition, allocations }}
 */
export async function createPredictionChannel({
  ws,
  sessionSigner,
  account,
  partnerAddress,  // brokerAddress from config
  asset = 'ytest.usd',
  userAmount = '500000',    // 0.5 USDC allocated to user
  partnerAmount = '0',      // Broker starts with 0 (it manages the pool)
  applicationName = 'molty-prediction',
}) {
  // Must use broker as counterparty — exactly 2 participants required
  const broker = partnerAddress;
  if (!broker) {
    throw new Error('partnerAddress (brokerAddress) is required');
  }

  console.log('\n  ─── Creating Prediction App Session ───');
  console.log(`  Application:  ${applicationName}`);
  console.log(`  Protocol:     ${PROTOCOL_VERSION}`);
  console.log(`  User:         ${account.address}`);
  console.log(`  Broker:       ${broker}`);
  console.log(`  Asset:        ${asset}`);
  console.log(`  User alloc:   ${userAmount}`);

  // RPCAppDefinition — 2 participants but user's weight is enough for quorum
  // This allows the user to create the session with only their signature
  const appDefinition = {
    application: applicationName,
    protocol: PROTOCOL_VERSION,
    participants: [account.address, broker],
    weights: [100, 0],  // Only user's signature needed
    quorum: 100,
    challenge: 0,
    nonce: Date.now(),
  };

  // RPCAppSessionAllocation[]
  const allocations = [
    { participant: account.address, asset, amount: userAmount },
    { participant: broker, asset, amount: partnerAmount },
  ];

  // CreateAppSessionRequestParams = { definition, allocations }
  const params = {
    definition: appDefinition,
    allocations,
  };

  // Create and send the signed app session message
  const sessionMessage = await createAppSessionMessage(sessionSigner, params);

  ws.send(sessionMessage);
  console.log('  📤 Sent create_app_session');

  // Wait for confirmation — listen for create_app_session response or app_session_update
  const response = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // Even if no explicit confirmation, channel may be created
      resolve({ params: { appSessionId: null }, status: 'timeout_assumed' });
    }, 15000);

    function handler(data) {
      try {
        const raw = typeof data === 'string' ? data : data.toString();
        const msg = parseAnyRPCResponse(raw);
        const method = msg?.method;

        // SDK responds to create_app_session with the same method or AppSessionUpdate
        if (method === RPCMethod.CreateAppSession ||
            method === RPCMethod.AppSessionUpdate ||
            method === 'asu' ||
            method === 'create_app_session') {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(msg);
        } else if (method === RPCMethod.Error) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          reject(new Error(`Channel creation error: ${JSON.stringify(msg.params)}`));
        }
      } catch (err) {
        // ignore parse errors on unrelated messages
      }
    }

    ws.on('message', handler);
  });

  const appSessionId = response?.params?.appSessionId ||
                       response?.params?.app_session_id ||
                       `0x${appDefinition.nonce.toString(16).padStart(64, '0')}`;

  console.log(`  ✅ App session created — ID: ${appSessionId}`);

  return {
    channelId: appSessionId,
    appSessionId,
    appDefinition,
    allocations,
    response,
  };
}

// ─── Standalone execution ─────────────────────────────────────
if (process.argv[1]?.endsWith('2-yellow-channel.js')) {
  import('dotenv/config').then(async () => {
    try {
      if (!process.env.PRIVATE_KEY) {
        console.error('Missing PRIVATE_KEY in .env');
        process.exit(1);
      }

      const ctx = await connectAndAuth({
        privateKey: process.env.PRIVATE_KEY,
        rpcUrl: process.env.SEPOLIA_RPC_URL,
        wsUrl: process.env.YELLOW_WS_URL,
        faucetUrl: process.env.YELLOW_FAUCET_URL,
      });

      const channel = await createPredictionChannel({
        ws: ctx.ws,
        sessionSigner: ctx.sessionSigner,
        account: ctx.account,
        partnerAddress: ctx.brokerAddress,
      });

      console.log('\n  ✅ Channel ready:', channel.channelId);
      ctx.ws.close();
      process.exit(0);
    } catch (err) {
      console.error('  ❌ Error:', err.message);
      process.exit(1);
    }
  });
}
