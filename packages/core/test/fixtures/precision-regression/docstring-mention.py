def deploy():
    """
    This function does NOT execute bash directly. It only logs
    that a deployment happened. See the deploy runbook for the
    actual bash commands used in CI.
    """
    logger.info("deployment recorded")
