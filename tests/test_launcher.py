import importlib.util
from pathlib import Path
import unittest

class LauncherTests(unittest.TestCase):
    def test_v2_launcher_is_isolated_from_the_previous_delivery(self):
        source=Path(__file__).resolve().parents[1]/'tools'/'launch.py'
        self.assertTrue(source.exists(),'New standalone launcher is missing')
        spec=importlib.util.spec_from_file_location('launcher_v2',source)
        app=importlib.util.module_from_spec(spec);spec.loader.exec_module(app)
        self.assertEqual(app.URL,'http://127.0.0.1:8767')
        self.assertTrue(app.is_our_server({'mode':'simulation','deviceId':'HEADSAFE-ORIGINAL-DESIGN-DEMO'}))
        self.assertFalse(app.is_our_server({'mode':'simulation','deviceId':'HEADSAFE-SIMULATOR'}))
        self.assertFalse(app.is_our_server({'mode':'hardware','deviceId':'HEADSAFE-ORIGINAL-DESIGN-DEMO'}))
        self.assertFalse(app.is_our_server(None))
        self.assertEqual(app.ROOT,Path(__file__).resolve().parents[1])

if __name__=='__main__':unittest.main()
