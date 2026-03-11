# MERCURY - TRANSFORMING DRONE
<!-- Hardware / Platform -->
![Raspberry Pi](https://img.shields.io/badge/Raspberry%20Pi-A22846?style=flat&logo=raspberry-pi&logoColor=white)
![ArduPilot](https://img.shields.io/badge/ArduPilot-025930?style=flat&logo=ardupilot&logoColor=white)
![ESP32](https://img.shields.io/badge/ESP32-E7352C?style=flat&logo=espressif&logoColor=white)
![OpenCV](https://img.shields.io/badge/OpenCV-5C3EE8?style=flat&logo=opencv&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-000000?style=flat&logo=threedotjs&logoColor=white)
![Leaflet](https://img.shields.io/badge/Leaflet-199900?style=flat&logo=leaflet&logoColor=white)

![Mercury Banner](Media/Banner.png)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/mercuriustech)
[![Follow on X](https://img.shields.io/badge/Follow%20%40L42ARO-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/L42ARO)


## Quick Index

- [Demo](#demo)
- [Features](#features)
- [Folder Structure](#folder-structure)
- [Software Setup](#software-setup)

## Demo

[![Mercury Demo](https://img.youtube.com/vi/DZhdSxqXiKo/maxresdefault.jpg)](https://youtu.be/DZhdSxqXiKo)

## Features

<table width="100%">
  <tr>
    <td width="50%" align="center"><b>Inner Payload Bay (1 kg)</b></td>
    <td width="50%" align="center"><b>Simple Transformation Mechanism</b></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="Media/InnerPayload 2.png" alt="Inner Payload Bay" width="100%"/></td>
    <td width="50%" align="center"><img src="Media/LinearActuators.png" alt="Simple Transformation Mechanism" width="100%"/></td>
  </tr>
</table>

<table width="100%">
  <tr>
    <td width="50%" align="center"><b>RGB + Depth + Thermal Cameras</b></td>
    <td width="50%" align="center"><b>Ardupilot + GPS</b></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="Media/Sensors.jpg" alt="RGB + Depth + Thermal Cameras" width="100%"/></td>
    <td width="50%" align="center"><img src="Media/TopDownDrone.png" alt="Ardupilot + GPS" width="100%"/></td>
  </tr>
</table>

<table width="100%">
  <tr>
    <td width="50%" align="center"><b>Wheel + Prop Guard</b></td>
    <td width="50%" align="center"><b>Mobile App</b></td>
  </tr>
  <tr>
    <td width="50%" align="center"><img src="Media/WheelProp.png" alt="Wheel + Prop Guard" width="100%"/></td>
    <td width="50%" align="center"><img src="Media/MobileApp.png" alt="Mobile App" width="100%"/></td>
  </tr>
</table>

## Folder Structure
- **STL Files:** all the required stl files for the drone assembly
- **Autonomy Software:** all the required software for the drone autonomy
- **PCB Files:** all the gerber files for the drone PCBs

## Software Setup

To use the software as it is, upload the Autonomy Software folder to a Raspberry Pi 5, using your preferred SCP method. For beginners we recommend [WinSCP](https://winscp.net/eng/download.php).

Inside the folder in the raspberry pi create a virtual environment and install the dependencies.

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

You must run both the Mavproxy Bridge to interface with the flight controller as well as the main software powering the rest of the robot. For that run in two separate temrinals the scripts:

```bash
start_mavproxy.sh
```
```bash
run.sh
```
In the terminal you should see the IP addres to be able to control the robot, if you're connected to the same network just copy paste that on your browser.

If you would like to be able to control it from different networks and at long distances we recommend you setup [Tailscale](https://tailscale.com/) on your devices.

For more convenience you can setup these scripts to run automatically on startup, and then use other scripts like `restarter.sh` or `killer.sh` to manage them.

## 🧑‍💻 Official Codebase Core Contributors and Maintainers

<table>
  <tr>
    <td align="center">
      <a href="https://x.com/L42ARO">
        <img src="https://images.weserv.nl/?url=https://pbs.twimg.com/profile_images/1995738246702399488/ZSnjIfgK_400x400.jpg&h=100&w=100&fit=cover&mask=circle&maxage=7d" width="100px;" alt=""/>
      </a>
      <br />
      <sub><b>Alvaro L</b></sub>
    </td>
    <td align="center">
      <a href="https://x.com/pericleshimself">
        <img src="https://images.weserv.nl/?url=https://pbs.twimg.com/profile_images/1976158790861963264/uqXdzZBm_400x400.jpg&h=100&w=100&fit=cover&mask=circle&maxage=7d" width="100px;" alt=""/>
      </a>
      <br />
      <sub><b>Connor Raymer</b></sub>
    </td>
  </tr>
</table>


[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/mercuriustech)

