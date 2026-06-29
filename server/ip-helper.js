import os from 'os';

/**
 * Validates if an IP address is a private LAN IPv4 address.
 * Matches:
 * - 192.168.x.x
 * - 10.x.x.x
 * - 172.16.x.x - 172.31.x.x
 * @param {string} ip The IP address to test.
 * @returns {boolean} True if the address is a private IPv4.
 */
function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

/**
 * Checks if an interface name matches standard ignore patterns.
 * Ignores loopbacks, Docker, VPNs, and VM virtual adapters.
 * @param {string} name Interface name.
 * @returns {boolean} True if the interface should be ignored.
 */
function shouldIgnoreInterface(name) {
  const lower = name.toLowerCase();
  return (
    lower.startsWith('lo') ||
    lower.startsWith('docker') ||
    lower.startsWith('bridge') ||
    lower.startsWith('veth') ||
    lower.startsWith('utun') ||
    lower.startsWith('vbox') ||
    lower.startsWith('vmnet')
  );
}

/**
 * Dynamically resolves the active LAN IPv4 address and interface.
 * Implements macOS en0 priority, and filters out VPNs/virtual adapters/Docker bridges.
 * @returns {{ interface: string, ip: string }} Object containing name of interface and IP address.
 */
export function getLocalIPInfo() {
  const interfaces = os.networkInterfaces();
  const isMac = os.platform() === 'darwin';

  // 1. macOS specific priority check: en0
  if (isMac && interfaces['en0']) {
    for (const iface of interfaces['en0']) {
      if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
        if (isPrivateIPv4(iface.address)) {
          return { interface: 'en0', ip: iface.address };
        }
      }
    }
  }

  // 2. Full scan (other operating systems, or if en0 has no valid private IP on macOS)
  for (const name of Object.keys(interfaces)) {
    if (shouldIgnoreInterface(name)) continue;

    for (const iface of interfaces[name]) {
      if ((iface.family === 'IPv4' || iface.family === 4) && !iface.internal) {
        if (isPrivateIPv4(iface.address)) {
          return { interface: name, ip: iface.address };
        }
      }
    }
  }

  // 3. Fallback if no matching LAN interface is detected
  return { interface: 'loopback', ip: '127.0.0.1' };
}
