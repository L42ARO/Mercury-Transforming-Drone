# extensions.py
from flask_cors import CORS
from flask_socketio import SocketIO

socketio = SocketIO()   # configured in app.py
cors = CORS()
