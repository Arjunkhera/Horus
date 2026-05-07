export function getMcpConfig() {
  return {
    anvil: {
      type: 'http',
      url: `http://${process.env.ANVIL_HOST || 'anvil'}:${process.env.ANVIL_PORT || '8100'}`,
    },
  };
}
