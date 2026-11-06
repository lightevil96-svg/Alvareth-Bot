"""HTTP adapter contract tests; inference deliberately mocked, never a model quality test."""
import importlib.util
import json
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
spec = importlib.util.spec_from_file_location("voice_service", Path(__file__).parents[1] / "video-studio/services/voxcpm/server.py")
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

class ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.http = service.ThreadingHTTPServer(("127.0.0.1", 0), service.Handler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = "http://127.0.0.1:" + str(cls.http.server_port)
    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown()
        cls.http.server_close()
        cls.thread.join()
    def request(self, path, body=None):
        request = urllib.request.Request(self.url + path, data=None if body is None else json.dumps(body).encode(), headers={"Content-Type":"application/json"})
        try:
            with urllib.request.urlopen(request, timeout=5) as result:
                return result.status, json.loads(result.read())
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read())
    def test_not_ready(self):
        service.MODEL = None
        self.assertEqual(self.request("/health")[0], 503)
        self.assertEqual(self.request("/speech", {"text":"Halo"})[0], 503)
    def test_request_validation(self):
        self.assertEqual(self.request("/speech", {"text":""})[0],400)
        self.assertEqual(self.request("/speech", ["bad"])[0],400)
        self.assertEqual(self.request("/speech", {"text":"x"*1201})[0],400)
    def test_serial_inference(self):
        service.MODEL = object()
        service.LOCK.acquire()
        try:
            self.assertEqual(self.request("/speech", {"text":"Halo"})[0],429)
        finally:
            service.LOCK.release()
        received = {}
        def fake_synthesize(text, language, voice_description=None):
            received["voice_description"] = voice_description
            return {"provider":"VoxCPM2", "fixture":True}
        service.synthesize = fake_synthesize
        self.assertEqual(self.request("/speech", {"text":"Halo", "voice_description":"warm narrator"})[1]["fixture"], True)
        self.assertEqual(received["voice_description"], "warm narrator")
        self.assertFalse(service.LOCK.locked())

if __name__ == "__main__":
    unittest.main()
