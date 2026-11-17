import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from pydantic import ValidationError
from fastapi import HTTPException
import intent_api
from intent_api import IntentQuestion, classifier, classify_intent, intent_health

class IntentTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from intent_lab.intent import train
        cls.models = tempfile.TemporaryDirectory()
        train(Path(cls.models.name))
        cls.model_patch = patch.object(intent_api, 'MODEL_DIR', Path(cls.models.name))
        cls.model_patch.start()
        classifier.cache_clear()

    @classmethod
    def tearDownClass(cls):
        classifier.cache_clear()
        cls.model_patch.stop()
        cls.models.cleanup()
    def tearDown(self):
        classifier.cache_clear()

    def test_trained_artifact_is_readable_but_below_gate(self):
        classifier.cache_clear()
        health = intent_health()
        self.assertTrue(health['ready'])
        self.assertFalse(health['evaluationEligible'])
        with patch.dict(os.environ, {'AURORE_INTENT_ENABLE_ROUTING': '1'}):
            answer = classify_intent(IntentQuestion(question='집주인이 보증금을 반환하지 않아요'))
        self.assertIn(answer['label'], intent_api.LABELS)
        self.assertEqual(len(answer['modelVersion']), 64)
        self.assertFalse(answer['routingEnabled'])
        self.assertNotIn('question', answer)
        self.assertNotIn('집주인', json.dumps(answer, ensure_ascii=False))

    def test_bad_or_missing_artifact_fails_closed_without_path_leak(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(intent_api, 'MODEL_DIR', Path(temp)):
                classifier.cache_clear()
                self.assertFalse(intent_health()['ready'])
                with self.assertRaises(HTTPException) as result:
                    classify_intent(IntentQuestion(question='안녕'))
                self.assertEqual(result.exception.status_code, 503)
                self.assertNotIn(temp, result.exception.detail)
                (Path(temp) / 'intent.joblib').write_bytes(b'not-a-model')
                (Path(temp) / 'evaluation.json').write_text(json.dumps({'model_sha256': 'wrong'}))
                with self.assertRaises(ValueError):
                    classifier()

    def test_request_limits_and_opt_in_gate(self):
        for payload in ({'question': ' '}, {'question': 'x'*1001}, {'question': '\ufb03'*400}, {'question': 'hello', 'train': True}):
            with self.assertRaises(ValidationError):
                IntentQuestion(**payload)
        with patch.dict(os.environ, {'AURORE_INTENT_ENABLE_ROUTING': ''}):
            self.assertFalse(intent_api.routing_enabled(True))
        with patch.dict(os.environ, {'AURORE_INTENT_ENABLE_ROUTING': '1'}):
            self.assertTrue(intent_api.routing_enabled(True))
            self.assertFalse(intent_api.routing_enabled(False))

if __name__ == '__main__':
    unittest.main()
