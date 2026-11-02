"""Source integration gates supplementary to native behavioral tests and real build."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parents[1]
class Firmware(unittest.TestCase):
    def test_original_accelerometer_only_sample_and_contract(self):
        s=(ROOT/'firmware/HeadSafe/HeadSafe.ino').read_text()
        self.assertIn('uint8_t raw[6]',s)
        self.assertIn('headsafe::parseAcceleration(raw,sizeof(raw),motion)',s)
        self.assertNotIn('writeRegister(0x1B,',s)
        for field in ('gx','gy','gz','battery','latitude'):
            self.assertNotIn('\\"'+field+'\\"',s)
        for field in ('sampleRateHz','resetCommandsRemaining'):
            self.assertIn('\\"'+field+'\\"',s)
    def test_host_checked_before_origin_or_static_bytes(self):
        s=(ROOT/'firmware/HeadSafe/HeadSafe.ino').read_text()
        self.assertIn('headsafe::allowedHost(server.hostHeader().c_str()',s)
        self.assertIn('if(!allowedHost()) return false;',s)
        self.assertIn('if(!allowedHost()) return;',s)
    def test_reset_rejects_embedded_nul_in_json(self):
        s=(ROOT/'firmware/HeadSafe/HeadSafe.ino').read_text()
        self.assertIn('body.length()!=strlen(body.c_str())',s)
    def test_table_driven_gzip_without_simulator(self):
        s=(ROOT/'firmware/HeadSafe/HeadSafe.ino').read_text()
        self.assertIn('WEB_ASSET_COUNT',s)
        self.assertIn('server.sendHeader("Content-Encoding","gzip")',s)
        self.assertIn('reinterpret_cast<const char*>(asset.data),asset.size',s)
        self.assertNotIn('/api/simulate',s)
        self.assertNotIn('Access-Control-Allow-Origin',s)
        self.assertIn('font-src \'self\'',s)
if __name__=='__main__': unittest.main()
