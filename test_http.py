"""HTTP boundary checks for malformed requests, stale clicks and save compatibility."""
import json
from pathlib import Path
import tempfile
from threading import Thread
import unittest
import urllib.request
import urllib.error
from game import create_server

class HttpTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(dir=Path(__file__).parent,prefix='.test-http-')
        self.server=create_server(Path(self.temp.name)/'save.json')
        self.thread=Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.temp.cleanup()
    def post(self,data,origin=None):
        headers={'Content-Type':'application/json'}
        if origin:headers['Origin']=origin
        req=urllib.request.Request(self.server.url+'api/action',data=json.dumps(data).encode(),headers=headers)
        with urllib.request.urlopen(req) as r:return json.load(r)
    def test_invalid_and_stale_actions_do_not_mutate(self):
        for payload in ({'action':'node','index':True,'revision':0},{'action':'level','index':10,'revision':0},{'action':'reset','revision':99}):
            with self.assertRaises(urllib.error.HTTPError) as error:self.post(payload)
            self.assertEqual(error.exception.code,400)
        self.assertEqual(self.server.session.revision,0)
        state=self.post({'action':'node','index':1,'revision':0});self.assertEqual(state['state']['current'],1)
        with self.assertRaises(urllib.error.HTTPError):self.post({'action':'node','index':2,'revision':0})
        self.assertEqual(self.server.session.game.state.current,1)
    def test_foreign_origin_and_unknown_paths(self):
        with self.assertRaises(urllib.error.HTTPError) as error:self.post({'action':'reset','revision':0},'https://example.com')
        self.assertEqual(error.exception.code,403)
        with self.assertRaises(urllib.error.HTTPError):urllib.request.urlopen(self.server.url+'../data/progress.json')
    def test_json_distances_and_mime(self):
        state=self.post({'action':'level','index':4,'revision':0})
        self.assertEqual(state['state']['distances'],[0,None,None,None,None,None,None])
        with urllib.request.urlopen(self.server.url+'style.css') as response:
            self.assertIn('text/css',response.headers['Content-Type']);self.assertIn(b'clamp(',response.read())

if __name__=='__main__':unittest.main()
