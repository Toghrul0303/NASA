"""Startup and contract errors."""


class ConfigError(Exception):
    """Configuration failed validation or a contract-constant assertion."""


class ContractError(Exception):
    """DATA_CONTRACT.md could not be extracted or checked."""
