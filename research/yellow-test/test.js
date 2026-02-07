#!/usr/bin/env node
/**
 * Yellow Network Nitrolite SDK Test
 * Verifies SDK works with your private key.
 */
import 'dotenv/config';
import WebSocket from 'ws';
import {
  createAuthRequestMessage,
  createAuthVerifyMessageFromChallenge,
  createEIP712AuthMessageSigner,
  createECDSAMessageSigner,
  createGetConfigMessageV2,
  parseAnyRPCResponse,
  RPCMethod,
} from '@erc7824/nitrolite';
import { createWalletClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.ALCHEMY_RPC_URL || 'https://rpc.sepolia.org';

if (!PRIVATE_KEY) {
  console.error('Missing PRIVATE_KEY in .env');
  process.exit(1);
}

const pk = PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
const account = privateKeyToAccount(pk);

// Generate temporary session key
const sessionPrivateKey = generatePrivateKey();
const sessionAccount = privateKeyToAccount(sessionPrivateKey);
const sessionSigner = createECDSAMessageSigner(sessionPrivateKey);

// Setup wallet client for EIP-712 signing (main wallet)
const walletClient = createWalletClient({
  chain: sepolia,
  transport: http(RPC_URL),
  account,
});

const WS_URL = 'wss://clearnet-sandbox.yellow.com/ws';

// Auth params (must match between auth_request and EIP712 signer)
const authParams = {
  address: account.address,
  session_key: sessionAccount.address,
  application: 'yellow-test',
  allowances: [{ asset: 'ytest.usd', amount: '1000000000' }],
  expires_at: BigInt(Math.floor(Date.now() / 1000) + 3600),
  scope: 'test.app',
};

let eip712Signer = null;

async function run() {
  console.log('🦞 Yellow Network Nitrolite SDK Test');
  console.log('Wallet:', account.address);
  console.log('Session key:', sessionAccount.address);
  console.log('Connecting to', WS_URL, '...\n');

  const ws = new WebSocket(WS_URL);

  return new Promise((resolve, reject) => {
    ws.on('open', async () => {
      console.log('✅ WebSocket connected');

      try {
        const authRequestMsg = await createAuthRequestMessage(authParams);
        ws.send(authRequestMsg);
        console.log('📤 Sent auth_request');
      } catch (err) {
        console.error('auth_request error:', err);
        ws.close();
        reject(err);
      }
    });

    ws.on('message', async (data) => {
      try {
        const raw = typeof data === 'string' ? data : data.toString();
        const msg = parseAnyRPCResponse(raw);
        const method = msg?.method;

        switch (method) {
          case RPCMethod.AuthChallenge: {
            const challenge = msg?.params?.challengeMessage;
            if (!challenge) {
              console.error('No challenge in auth_challenge:', msg);
              break;
            }
            console.log('📨 Received auth_challenge');

            eip712Signer = createEIP712AuthMessageSigner(walletClient, {
              scope: authParams.scope,
              session_key: authParams.session_key,
              expires_at: authParams.expires_at,
              allowances: authParams.allowances,
            }, { name: authParams.application });

            const authVerifyMsg = await createAuthVerifyMessageFromChallenge(eip712Signer, challenge);
            ws.send(authVerifyMsg);
            console.log('📤 Sent auth_verify');
            break;
          }

          case RPCMethod.AuthVerify: {
            const success = msg?.params?.success;
            if (success) {
              console.log('✅ Authentication successful!\n');
              // Request config to verify SDK works
              const configMsg = createGetConfigMessageV2();
              ws.send(configMsg);
              console.log('📤 Sent get_config');
            } else {
              const errMsg = msg?.params ?? 'Unknown';
              console.error('❌ Authentication failed:', errMsg);
              ws.close();
              reject(new Error('Auth failed'));
            }
            break;
          }

          case RPCMethod.GetConfig: {
            const config = msg?.params;
            console.log('📨 Received get_config:', JSON.stringify(config, null, 2));
            console.log('\n✅ Yellow SDK is working! Authentication + get_config succeeded.');
            ws.close();
            resolve();
            break;
          }

          case RPCMethod.Error: {
            const err = msg?.params ?? msg;
            console.error('❌ RPC Error:', err);
            ws.close();
            reject(new Error(JSON.stringify(err)));
            break;
          }

          default:
            if (method) console.log('📨 Message:', method, msg?.params ?? '');
            break;
        }
      } catch (err) {
        console.error('Message handler error:', err);
      }
    });

    ws.on('error', (err) => {
      console.error('WebSocket error:', err);
      reject(err);
    });

    ws.on('close', (code, reason) => {
      if (code === 1000) resolve();
    });
  });
}

run()
  .then(() => {
    console.log('\nDone.');
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
