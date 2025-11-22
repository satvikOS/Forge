#!/usr/bin/env python3
"""
Wikipedia Package Installer
Installs the Python wikipedia package for architectural data extraction
"""
import subprocess
import sys

def install_wikipedia():
    """Install wikipedia package if not already installed"""
    try:
        import wikipedia
        print("✅ Wikipedia package already installed")
        return True
    except ImportError:
        print("📦 Installing wikipedia package...")
        try:
            subprocess.check_call([sys.executable, "-m", "pip", "install", "wikipedia"])
            print("✅ Wikipedia package installed successfully")
            return True
        except subprocess.CalledProcessError as e:
            print(f"❌ Failed to install wikipedia package: {e}")
            return False

if __name__ == "__main__":
    success = install_wikipedia()
    sys.exit(0 if success else 1)
