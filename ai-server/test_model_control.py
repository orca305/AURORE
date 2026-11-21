import os
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException

import external_model
import legal_explain
import model_control


class FakeClient:
    def __init__(self, host):
        self.host = host


class FakeRequest:
    def __init__(self, host="127.0.0.1", headers=None):
        self.client = FakeClient(host)
        self.headers = headers or {}


class ModelControlTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"AURORE_AI_STATE_FILE": os.path.join(self.dir.name, "m.json"), "AURORE_EXPLAIN_PROVIDER": "anthropic", "AURORE_EXPLAIN_MODEL": "claude-haiku-5-5"}, clear=False)
        self.env.start()
        os.environ.pop("AURORE_AI_ADMIN_TOKEN", None)
        model_control.reset_for_tests()

    def tearDown(self):
        model_control.reset_for_tests()
        self.env.stop()
        self.dir.cleanup()

    def test_default_follows_environment(self):
        self.assertEqual(model_control.provider(), "external")
        self.assertEqual(model_control.external_model(), "claude-haiku-5-5")
        self.assertFalse(model_control.is_overridden())

    def test_switch_to_allowed_model_and_local_and_reject_others(self):
        model_control.set_model("claude-sonnet-5-5")
        self.assertEqual((model_control.provider(), model_control.external_model()), ("external", "claude-sonnet-5-5"))
        model_control.set_model("LOCAL")
        self.assertEqual(model_control.provider(), "local")
        with self.assertRaises(ValueError):
            model_control.set_model("claude-opus-5-5")
        self.assertEqual(model_control.provider(), "local")  # 거절된 요청은 상태를 바꾸지 않는다

    def test_override_survives_restart_via_file(self):
        model_control.set_model("claude-sonnet-5-5")
        model_control._override = None  # 서버를 다시 켠 것처럼
        model_control.load()
        self.assertEqual(model_control.external_model(), "claude-sonnet-5-5")

    def test_saved_model_removed_from_allowed_list_is_ignored(self):
        model_control.set_model("claude-sonnet-5-5")
        model_control._override = None
        with patch.dict(os.environ, {"AURORE_ALLOWED_MODELS": "claude-haiku-5-5"}):
            model_control.load()
        self.assertFalse(model_control.is_overridden())

    def test_model_json_uses_the_selected_provider(self):
        model_control.set_model("LOCAL")
        with patch.object(legal_explain, "local_json", return_value={"from": "local"}) as local, patch.object(legal_explain, "_anthropic_json", return_value={"from": "ext"}) as ext:
            self.assertEqual(legal_explain._model_json("s", {}), {"from": "local"})
        local.assert_called_once()
        ext.assert_not_called()

    def test_external_call_uses_the_selected_model_name(self):
        model_control.set_model("claude-sonnet-5-5")
        sent = {}

        class Resp:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, *a):
                return b'{"content":[{"type":"text","text":"{\\"ok\\":true}"}]}'

        def fake_open(request, timeout=0):
            import json as _json
            sent["model"] = _json.loads(request.data)["model"]
            sent["thinking"] = "thinking" in _json.loads(request.data)
            return Resp()

        with patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}), patch("urllib.request.urlopen", fake_open), patch("json.load", return_value={"content": [{"type": "text", "text": "{\"ok\": true}"}]}):
            external_model.anthropic_json("s", {}, schema={})
        self.assertEqual(sent["model"], "claude-sonnet-5-5")
        self.assertFalse(sent["thinking"])  # Sonnet 계열은 thinking 항목을 보내지 않는다

    def test_endpoint_requires_local_client_and_token(self):
        body = legal_explain.ModelChange(model="claude-sonnet-5-5")
        with self.assertRaises(HTTPException) as remote:
            legal_explain.change_answer_model(body, FakeRequest(host="10.0.0.5"))
        self.assertEqual(remote.exception.status_code, 403)
        with patch.dict(os.environ, {"AURORE_AI_ADMIN_TOKEN": "secret-token"}):
            with self.assertRaises(HTTPException) as wrong:
                legal_explain.change_answer_model(body, FakeRequest(headers={"x-aurore-admin-token": "nope"}))
            self.assertEqual(wrong.exception.status_code, 403)
            ok = legal_explain.change_answer_model(body, FakeRequest(headers={"x-aurore-admin-token": "secret-token"}))
        self.assertEqual(ok["selectedModel"], "claude-sonnet-5-5")
        self.assertTrue(ok["overridden"])

    def test_endpoint_rejects_models_outside_the_allowed_list_and_clears_cooldown(self):
        with self.assertRaises(HTTPException) as bad:
            legal_explain.change_answer_model(legal_explain.ModelChange(model="claude-opus-5-5"), FakeRequest())
        self.assertEqual(bad.exception.status_code, 422)
        external_model._blocked_until, external_model._blocked_kind = 9e12, "BUDGET_EXHAUSTED"
        legal_explain.change_answer_model(legal_explain.ModelChange(model="claude-haiku-5-5"), FakeRequest())
        self.assertIsNone(external_model.external_blocked())


if __name__ == "__main__":
    unittest.main()
