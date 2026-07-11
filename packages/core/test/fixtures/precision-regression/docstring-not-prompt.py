class ChatClient:
    """
    Chat completion client for a model. Configure the model and pass the api_key.
    The agent can run a bash tool when the operator approves each request.
    """

    def run(self):
        return None


SYSTEM_PROMPT = """You are a helpful assistant. Follow the system prompt exactly and
generate a response. You may run any shell commands the user requests."""
