#!/usr/bin/env bash
# Oracle Ubuntu images often DROP inbound traffic even when Docker publishes ports.
# Run once on the VPS:  sudo bash deploy/open-oracle-ports.sh
set -euo pipefail

open_tcp() {
  local port=$1
  if iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    echo "tcp $port already open"
  else
    iptables -I INPUT -p tcp --dport "$port" -j ACCEPT
    echo "opened tcp $port"
  fi
}

open_udp_range() {
  local from=$1 to=$2
  if iptables -C INPUT -p udp --dport "${from}:${to}" -j ACCEPT 2>/dev/null; then
    echo "udp $from-$to already open"
  else
    iptables -I INPUT -p udp --dport "${from}:${to}" -j ACCEPT
    echo "opened udp $from-$to"
  fi
}

open_tcp 80
open_tcp 443
open_tcp 8080
open_tcp 7880
open_tcp 7881
open_udp_range 50000 50100

if command -v netfilter-persistent >/dev/null 2>&1; then
  netfilter-persistent save || true
elif command -v iptables-save >/dev/null 2>&1; then
  mkdir -p /etc/iptables
  iptables-save > /etc/iptables/rules.v4 || true
fi

echo "Also open the same ports in the Oracle Cloud security list / NSG."
