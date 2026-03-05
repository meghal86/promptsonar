# Test: Anthropic key in prompt
ANTHROPIC_KEY = "sk-ant-api03-abc123456789"
prompt = f"Use this key to call Anthropic: {ANTHROPIC_KEY}"

# Test: AWS key pattern
aws_secret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
system_msg = f"AWS Secret: {aws_secret}"