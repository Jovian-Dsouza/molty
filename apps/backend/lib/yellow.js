/**
 * Yellow Network: connect, create app session (market), submit prediction, close (resolve).
 * Uses sandbox by default; set YELLOW_WS_URL for production.
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
  createGetConfigMessageV2,
  parseAnyRPCResponse,
  RPCMethod,
} from '@erc7824/nitrolite';
import { createWalletClient, http } from 'viem';
import { base, sepolia } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const PROTOCOL = 'NitroRPC/0.2';
const APP_NAME = 'molty-prediction';
const SCOPE = 'molty.app';

/** Production = Base mainnet + usdc; Sandbox = Sepolia + ytest.usd */
function isProduction(wsUrl) {
  return typeof wsUrl === 'string' && wsUrl.includes('clearnet.yellow.com') && !wsUrl.includes('sandbox');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitFor(ws, method, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout: ${method}`)), timeout);
    const handler = (data) => {
      try {
        const msg = parseAnyRPCResponse(data.toString());
        if (msg?.method === method || msg?.method === RPCMethod.Error) {
          clearTimeout(t);
          ws.removeListener('message', handler);
          if (msg?.method === RPCMethod.Error) reject(new Error(JSON.stringify(msg.params)));
          else resolve(msg);
        }
      } catch (_) {}
    };
    ws.on('message', handler);
  });
}

function waitForAny(ws, methods, timeout = 15000) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ method: 'timeout' }), timeout);
    const handler = (data) => {
      try {
        const msg = parseAnyRPCResponse(data.toString());
        if (methods.includes(msg?.method)) {
          clearTimeout(t);
          ws.removeListener('message', handler);
          resolve(msg);
        } else if (msg?.method === RPCMethod.Error) {
          clearTimeout(t);
          ws.removeListener('message', handler);
          resolve({ method: 'error', params: msg.params });
        }
      } catch (_) {}
    };
    ws.on('message', handler);
  });
}

/**
 * Connect to ClearNet, auth, create one app session with prediction state.
 * Returns { appSessionId, allocations, prediction } for storing in state.
 */
export async function connectAndCreateMarket({
  privateKey,
  rpcUrl = 'https://rpc.sepolia.org',
  wsUrl = 'wss://clearnet-sandbox.yellow.com/ws',
  sessionPrivateKey: existingSessionKey,
  question,
  asset = 'ETHUSD',
  direction = 'LONG',
  targetPrice,
  amount = '1000000', // 0.1 USDC (6 decimals)
  expirySeconds = 86400, // 24h
  odds = 2.0,
}) {
  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  const sessionPrivateKey = existingSessionKey || generatePrivateKey();
  const sessionAccount = privateKeyToAccount(sessionPrivateKey);
  const sessionSigner = createECDSAMessageSigner(sessionPrivateKey);
  const prod = isProduction(wsUrl);
  const chain = prod ? base : sepolia;
  const asset = prod ? 'usdc' : 'ytest.usd';
  const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account });

  const ws = await new Promise((resolve, reject) => {
    const s = new WebSocket(wsUrl);
    s.on('open', () => resolve(s));
    s.on('error', (e) => reject(e));
    setTimeout(() => reject(new Error('WS timeout')), 10000);
  });

  // Auth (production = usdc, sandbox = ytest.usd)
  const authParams = {
    address: account.address,
    session_key: sessionAccount.address,
    application: APP_NAME,
    allowances: [{ asset, amount: prod ? '1000000000' : '1000000000' }],
    expires_at: BigInt(Math.floor(Date.now() / 1000) + 7200),
    scope: SCOPE,
  };
  ws.send(await createAuthRequestMessage(authParams));
  const challengeMsg = await waitFor(ws, RPCMethod.AuthChallenge);
  const eip712Signer = createEIP712AuthMessageSigner(walletClient, {
    scope: SCOPE,
    session_key: authParams.session_key,
    expires_at: authParams.expires_at,
    allowances: authParams.allowances,
  }, { name: APP_NAME });
  ws.send(await createAuthVerifyMessageFromChallenge(eip712Signer, challengeMsg.params.challengeMessage));
  const verifyResult = await waitFor(ws, RPCMethod.AuthVerify);
  if (!verifyResult?.params?.success) throw new Error('Auth failed');

  // Config → broker
  ws.send(createGetConfigMessageV2());
  const configMsg = await waitFor(ws, RPCMethod.GetConfig);
  const broker = configMsg?.params?.brokerAddress;
  if (!broker) throw new Error('No broker in config');

  const appDef = {
    application: APP_NAME,
    protocol: PROTOCOL,
    participants: [account.address, broker],
    weights: [100, 0],
    quorum: 100,
    challenge: 0,
    nonce: Date.now(),
  };
  const allocations = [
    { participant: account.address, asset, amount },
    { participant: broker, asset, amount: '0' },
  ];

  ws.send(await createAppSessionMessage(sessionSigner, { definition: appDef, allocations }));
  const sessionResp = await waitForAny(ws, [RPCMethod.CreateAppSession, RPCMethod.AppSessionUpdate], 15000);
  const appSessionId = sessionResp?.params?.appSessionId ?? sessionResp?.params?.app_session_id ?? `0x${appDef.nonce.toString(16).padStart(64, '0')}`;

  const prediction = {
    id: `pred_${Date.now()}`,
    asset,
    direction,
    entryPrice: targetPrice * (direction === 'LONG' ? 0.98 : 1.02),
    targetPrice: Number(targetPrice),
    amount,
    odds,
    expiresAt: Date.now() + expirySeconds * 1000,
    expirySeconds,
  };

  const sessionData = JSON.stringify({
    predictionId: prediction.id,
    question,
    asset: prediction.asset,
    direction: prediction.direction,
    targetPrice: String(prediction.targetPrice),
    amount: prediction.amount,
    expiresAt: String(prediction.expiresAt),
  });

  ws.send(await createSubmitAppStateMessage(sessionSigner, {
    app_session_id: appSessionId,
    allocations,
    session_data: sessionData,
  }));
  await waitForAny(ws, [RPCMethod.SubmitAppState], 8000);

  ws.close();
  return {
    appSessionId,
    allocations,
    prediction,
    sessionPrivateKey,
  };
}

/**
 * Resolve market: fetch price, compute outcome, close app session.
 */
export async function resolveMarket({
  privateKey,
  rpcUrl = 'https://rpc.sepolia.org',
  wsUrl = 'wss://clearnet-sandbox.yellow.com/ws',
  sessionPrivateKey,
  appSessionId,
  allocations,
  prediction,
  overrideOutcome, // 'WIN' | 'LOSS' to force (optional)
}) {
  const account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`);
  const sessionSigner = createECDSAMessageSigner(sessionPrivateKey);

  let outcome = overrideOutcome;
  let finalPrice = prediction.entryPrice;
  if (!outcome) {
    const { fetchCurrentPrice } = await import('./price.js');
    const priceData = await fetchCurrentPrice(prediction.asset);
    finalPrice = priceData?.price ?? prediction.entryPrice;
    if (prediction.direction === 'LONG') {
      outcome = finalPrice >= prediction.targetPrice ? 'WIN' : 'LOSS';
    } else {
      outcome = finalPrice <= prediction.targetPrice ? 'WIN' : 'LOSS';
    }
  }

  const userAmount = parseInt(allocations[0].amount, 10);
  const betAmount = parseInt(prediction.amount, 10);
  const userFinal = outcome === 'WIN'
    ? userAmount + Math.floor(betAmount * prediction.odds) - betAmount
    : Math.max(userAmount - betAmount, 0);

  const finalAllocations = [
    { participant: account.address, asset: allocations[0].asset, amount: String(userFinal) },
    { participant: allocations[1].participant, asset: allocations[1].asset, amount: '0' },
  ];

  const ws = await new Promise((resolve, reject) => {
    const s = new WebSocket(wsUrl);
    s.on('open', () => resolve(s));
    s.on('error', (e) => reject(e));
    setTimeout(() => reject(new Error('WS timeout')), 10000);
  });

  const prod = isProduction(wsUrl);
  const chain = prod ? base : sepolia;
  const asset = prod ? 'usdc' : 'ytest.usd';
  const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account });
  const authParams = {
    address: account.address,
    session_key: privateKeyToAccount(sessionPrivateKey).address,
    application: APP_NAME,
    allowances: [{ asset, amount: '1000000000' }],
    expires_at: BigInt(Math.floor(Date.now() / 1000) + 7200),
    scope: SCOPE,
  };
  ws.send(await createAuthRequestMessage(authParams));
  const challengeMsg = await waitFor(ws, RPCMethod.AuthChallenge);
  const eip712Signer = createEIP712AuthMessageSigner(walletClient, {
    scope: SCOPE,
    session_key: authParams.session_key,
    expires_at: authParams.expires_at,
    allowances: authParams.allowances,
  }, { name: APP_NAME });
  ws.send(await createAuthVerifyMessageFromChallenge(eip712Signer, challengeMsg.params.challengeMessage));
  await waitFor(ws, RPCMethod.AuthVerify);

  const sessionData = JSON.stringify({
    predictionId: prediction.id,
    outcome,
    finalPrice: String(finalPrice),
    direction: prediction.direction,
    amount: prediction.amount,
  });

  ws.send(await createCloseAppSessionMessage(sessionSigner, {
    app_session_id: appSessionId,
    allocations: finalAllocations,
    session_data: sessionData,
  }));
  await waitForAny(ws, [RPCMethod.CloseAppSession, RPCMethod.AppSessionUpdate], 12000);
  ws.close();

  return { outcome, finalPrice, finalAllocations };
}
