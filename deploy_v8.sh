#!/bin/bash
# AutoPerp V8 Deployment Script
# Usage: wsl bash deploy_v8.sh
PK="APrivateKey1zkp3c9xLUipKgyRHmiMaDQRvuFBEikfJtV2rvK3RHK8K97C"
ENDPOINT="https://api.explorer.provable.com/v1"
export PATH=$PATH:$HOME/.cargo/bin

echo "========================================="
echo "  AutoPerp V8 Deployment (--yes mode)"
echo "========================================="

echo ""
echo "[1/2] Deploying autoperp_core_v8.aleo..."
cd programs/autoperp_core
leo deploy --network testnet --endpoint "$ENDPOINT" --private-key "$PK" --broadcast --yes
echo ""

echo "[2/2] Deploying autoperp_core_private_v8.aleo..."
cd ../autoperp_core_private
leo deploy --network testnet --endpoint "$ENDPOINT" --private-key "$PK" --broadcast --yes
echo ""

echo "========================================="
echo "  All V8 Deployments Complete!"
echo "========================================="
