#!/usr/bin/env python3
"""
Aventaro Backend API Testing Suite
Tests all backend APIs for the Aventaro travel companion app
"""

import requests
import json
import sys
from datetime import datetime
import uuid

# Configuration
BASE_URL = "http://localhost:8001/api"
TEST_USERS = [
    {
        "email": "emma@test.com",
        "password": "pass123",
        "full_name": "Emma Johnson",
        "phone": "+1234567890",
        "date_of_birth": "1995-06-15",
        "gender": "female",
        "city": "New York",
        "interests": ["travel", "photography", "hiking"],
        "relationship_status": "single"
    },
    {
        "email": "michael@test.com", 
        "password": "pass123",
        "full_name": "Michael Smith",
        "phone": "+1234567891",
        "date_of_birth": "1992-03-22",
        "gender": "male",
        "city": "Los Angeles",
        "interests": ["adventure", "music", "food"],
        "relationship_status": "single"
    }
]

class AventaroAPITester:
    def __init__(self):
        self.session = requests.Session()
        self.tokens = {}
        self.user_ids = {}
        self.test_results = []
        
    def log_result(self, test_name, success, message, details=None):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        result = {
            "test": test_name,
            "status": status,
            "message": message,
            "details": details or {}
        }
        self.test_results.append(result)
        print(f"{status}: {test_name} - {message}")
        if details and not success:
            print(f"   Details: {details}")
    
    def make_request(self, method, endpoint, data=None, headers=None, params=None):
        """Make HTTP request with error handling"""
        url = f"{BASE_URL}{endpoint}"
        try:
            response = self.session.request(
                method=method,
                url=url,
                json=data,
                headers=headers,
                params=params,
                timeout=30
            )
            return response
        except requests.exceptions.RequestException as e:
            return None
    
    def test_auth_signup(self):
        """Test user signup"""
        print("\n=== Testing Authentication - Signup ===")
        
        for i, user_data in enumerate(TEST_USERS):
            # Add unique identifier to avoid conflicts
            test_user = user_data.copy()
            test_user["email"] = f"test_{uuid.uuid4().hex[:8]}_{user_data['email']}"
            test_user["phone"] = f"+123456789{i}{datetime.now().microsecond}"
            
            response = self.make_request("POST", "/auth/signup", test_user)
            
            if response is None:
                self.log_result(f"Signup User {i+1}", False, "Request failed - connection error")
                continue
                
            if response.status_code == 200:
                try:
                    data = response.json()
                    if "token" in data and "user" in data:
                        self.tokens[f"user_{i+1}"] = data["token"]
                        self.user_ids[f"user_{i+1}"] = data["user"]["id"]
                        print(f"DEBUG: User {i+1} token: {data['token'][:50]}...")
                        self.log_result(f"Signup User {i+1}", True, f"User created successfully")
                    else:
                        self.log_result(f"Signup User {i+1}", False, "Missing token or user in response", data)
                except json.JSONDecodeError:
                    self.log_result(f"Signup User {i+1}", False, "Invalid JSON response", {"response": response.text})
            else:
                try:
                    error_data = response.json()
                    self.log_result(f"Signup User {i+1}", False, f"HTTP {response.status_code}", error_data)
                except:
                    self.log_result(f"Signup User {i+1}", False, f"HTTP {response.status_code}", {"response": response.text})
    
    def test_auth_signin(self):
        """Test user signin with existing test users"""
        print("\n=== Testing Authentication - Signin ===")
        
        test_credentials = [
            {"login": "emma@test.com", "password": "pass123"},
            {"login": "michael@test.com", "password": "pass123"}
        ]
        
        for i, creds in enumerate(test_credentials):
            response = self.make_request("POST", "/auth/signin", creds)
            
            if response is None:
                self.log_result(f"Signin User {i+1}", False, "Request failed - connection error")
                continue
                
            if response.status_code == 200:
                try:
                    data = response.json()
                    if "token" in data and "user" in data:
                        self.tokens[f"existing_user_{i+1}"] = data["token"]
                        self.user_ids[f"existing_user_{i+1}"] = data["user"]["id"]
                        self.log_result(f"Signin User {i+1}", True, f"Login successful for {creds['login']}")
                    else:
                        self.log_result(f"Signin User {i+1}", False, "Missing token or user in response", data)
                except json.JSONDecodeError:
                    self.log_result(f"Signin User {i+1}", False, "Invalid JSON response", {"response": response.text})
            else:
                try:
                    error_data = response.json()
                    self.log_result(f"Signin User {i+1}", False, f"HTTP {response.status_code}", error_data)
                except:
                    self.log_result(f"Signin User {i+1}", False, f"HTTP {response.status_code}", {"response": response.text})
    
    def test_auth_me(self):
        """Test get current user endpoint"""
        print("\n=== Testing Authentication - Get Me ===")
        
        for user_key, token in self.tokens.items():
            headers = {"Authorization": f"Bearer {token}"}
            response = self.make_request("GET", "/auth/me", headers=headers)
            
            if response is None:
                self.log_result(f"Get Me {user_key}", False, "Request failed - connection error")
                continue
                
            if response.status_code == 200:
                try:
                    data = response.json()
                    if "id" in data and "email" in data:
                        self.log_result(f"Get Me {user_key}", True, f"User data retrieved successfully")
                    else:
                        self.log_result(f"Get Me {user_key}", False, "Missing required fields in response", data)
                except json.JSONDecodeError:
                    self.log_result(f"Get Me {user_key}", False, "Invalid JSON response", {"response": response.text})
            else:
                try:
                    error_data = response.json()
                    self.log_result(f"Get Me {user_key}", False, f"HTTP {response.status_code}", error_data)
                except:
                    self.log_result(f"Get Me {user_key}", False, f"HTTP {response.status_code}", {"response": response.text})
    
    def test_discover_users(self):
        """Test user discovery endpoint"""
        print("\n=== Testing Discovery - Users ===")
        
        # Use first available token
        if not self.tokens:
            self.log_result("Discover Users", False, "No authentication tokens available")
            return
            
        token = list(self.tokens.values())[0]
        headers = {"Authorization": f"Bearer {token}"}
        
        response = self.make_request("GET", "/users/discover", headers=headers)
        
        if response is None:
            self.log_result("Discover Users", False, "Request failed - connection error")
            return
            
        if response.status_code == 200:
            try:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("Discover Users", True, f"Retrieved {len(data)} discoverable users")
                else:
                    self.log_result("Discover Users", False, "Response is not a list", data)
            except json.JSONDecodeError:
                self.log_result("Discover Users", False, "Invalid JSON response", {"response": response.text})
        else:
            try:
                error_data = response.json()
                self.log_result("Discover Users", False, f"HTTP {response.status_code}", error_data)
            except:
                self.log_result("Discover Users", False, f"HTTP {response.status_code}", {"response": response.text})
    
    def test_discover_trips(self):
        """Test trip discovery endpoint"""
        print("\n=== Testing Discovery - Trips ===")
        
        if not self.tokens:
            self.log_result("Discover Trips", False, "No authentication tokens available")
            return
            
        token = list(self.tokens.values())[0]
        headers = {"Authorization": f"Bearer {token}"}
        
        response = self.make_request("GET", "/trips/discover", headers=headers)
        
        if response is None:
            self.log_result("Discover Trips", False, "Request failed - connection error")
            return
            
        if response.status_code == 200:
            try:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("Discover Trips", True, f"Retrieved {len(data)} discoverable trips")
                else:
                    self.log_result("Discover Trips", False, "Response is not a list", data)
            except json.JSONDecodeError:
                self.log_result("Discover Trips", False, "Invalid JSON response", {"response": response.text})
        else:
            try:
                error_data = response.json()
                self.log_result("Discover Trips", False, f"HTTP {response.status_code}", error_data)
            except:
                self.log_result("Discover Trips", False, f"HTTP {response.status_code}", {"response": response.text})
    
    def test_friend_requests(self):
        """Test friend request functionality"""
        print("\n=== Testing Friend Requests ===")
        
        if len(self.tokens) < 2:
            self.log_result("Friend Requests", False, "Need at least 2 authenticated users")
            return
        
        tokens = list(self.tokens.values())
        user_ids = list(self.user_ids.values())
        
        # Test sending friend request
        headers1 = {"Authorization": f"Bearer {tokens[0]}"}
        params = {"to_user_id": user_ids[1]}
        
        response = self.make_request("POST", "/users/friend-request", headers=headers1, params=params)
        
        if response is None:
            self.log_result("Send Friend Request", False, "Request failed - connection error")
        elif response.status_code == 200:
            self.log_result("Send Friend Request", True, "Friend request sent successfully")
        else:
            try:
                error_data = response.json()
                self.log_result("Send Friend Request", False, f"HTTP {response.status_code}", error_data)
            except:
                self.log_result("Send Friend Request", False, f"HTTP {response.status_code}", {"response": response.text})
        
        # Test getting friend requests
        headers2 = {"Authorization": f"Bearer {tokens[1]}"}
        response = self.make_request("GET", "/users/friend-requests", headers=headers2)
        
        if response is None:
            self.log_result("Get Friend Requests", False, "Request failed - connection error")
        elif response.status_code == 200:
            try:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("Get Friend Requests", True, f"Retrieved {len(data)} friend requests")
                    
                    # Test accepting friend request if any exist
                    if data:
                        request_id = data[0].get("id")
                        if request_id:
                            accept_response = self.make_request("POST", f"/users/friend-request/{request_id}/accept", headers=headers2)
                            if accept_response and accept_response.status_code == 200:
                                self.log_result("Accept Friend Request", True, "Friend request accepted successfully")
                            else:
                                self.log_result("Accept Friend Request", False, f"HTTP {accept_response.status_code if accept_response else 'No response'}")
                else:
                    self.log_result("Get Friend Requests", False, "Response is not a list", data)
            except json.JSONDecodeError:
                self.log_result("Get Friend Requests", False, "Invalid JSON response", {"response": response.text})
        else:
            try:
                error_data = response.json()
                self.log_result("Get Friend Requests", False, f"HTTP {response.status_code}", error_data)
            except:
                self.log_result("Get Friend Requests", False, f"HTTP {response.status_code}", {"response": response.text})
    
    def test_trip_operations(self):
        """Test trip creation and management"""
        print("\n=== Testing Trip Operations ===")
        
        if not self.tokens:
            self.log_result("Trip Operations", False, "No authentication tokens available")
            return
        
        token = list(self.tokens.values())[0]
        headers = {"Authorization": f"Bearer {token}"}
        
        # Test creating a trip
        trip_data = {
            "destination": "Bali, Indonesia",
            "start_date": "2024-06-15",
            "end_date": "2024-06-22",
            "budget_range": "$1000-2000",
            "trip_type": "adventure",
            "max_members": 6,
            "itinerary": "Exploring temples, beaches, and local culture in Bali"
        }
        
        response = self.make_request("POST", "/trips", trip_data, headers=headers)
        
        trip_id = None
        if response is None:
            self.log_result("Create Trip", False, "Request failed - connection error")
        elif response.status_code == 200:
            try:
                data = response.json()
                if "id" in data:
                    trip_id = data["id"]
                    self.log_result("Create Trip", True, "Trip created successfully")
                else:
                    self.log_result("Create Trip", False, "Missing trip ID in response", data)
            except json.JSONDecodeError:
                self.log_result("Create Trip", False, "Invalid JSON response", {"response": response.text})
        else:
            try:
                error_data = response.json()
                self.log_result("Create Trip", False, f"HTTP {response.status_code}", error_data)
            except:
                self.log_result("Create Trip", False, f"HTTP {response.status_code}", {"response": response.text})
        
        # Test getting user's trips
        response = self.make_request("GET", "/trips/my-trips", headers=headers)
        
        if response is None:
            self.log_result("Get My Trips", False, "Request failed - connection error")
        elif response.status_code == 200:
            try:
                data = response.json()
                if "created" in data and "joined" in data:
                    self.log_result("Get My Trips", True, f"Retrieved trips: {len(data['created'])} created, {len(data['joined'])} joined")
                else:
                    self.log_result("Get My Trips", False, "Missing created/joined fields", data)
            except json.JSONDecodeError:
                self.log_result("Get My Trips", False, "Invalid JSON response", {"response": response.text})
        else:
            try:
                error_data = response.json()
                self.log_result("Get My Trips", False, f"HTTP {response.status_code}", error_data)
            except:
                self.log_result("Get My Trips", False, f"HTTP {response.status_code}", {"response": response.text})
        
        # Test trip join request (if we have multiple users and a trip)
        if len(self.tokens) >= 2 and trip_id:
            second_token = list(self.tokens.values())[1]
            second_headers = {"Authorization": f"Bearer {second_token}"}
            
            response = self.make_request("POST", f"/trips/{trip_id}/join-request", headers=second_headers)
            
            if response is None:
                self.log_result("Join Trip Request", False, "Request failed - connection error")
            elif response.status_code == 200:
                self.log_result("Join Trip Request", True, "Join request sent successfully")
                
                # Test getting trip requests (as creator)
                response = self.make_request("GET", f"/trips/{trip_id}/requests", headers=headers)
                
                if response and response.status_code == 200:
                    try:
                        data = response.json()
                        if isinstance(data, list):
                            self.log_result("Get Trip Requests", True, f"Retrieved {len(data)} trip requests")
                            
                            # Test approving request if any exist
                            if data and len(self.user_ids) >= 2:
                                user_to_approve = list(self.user_ids.values())[1]
                                approve_response = self.make_request("POST", f"/trips/{trip_id}/approve/{user_to_approve}", headers=headers)
                                if approve_response and approve_response.status_code == 200:
                                    self.log_result("Approve Trip Request", True, "Trip request approved successfully")
                                else:
                                    self.log_result("Approve Trip Request", False, f"HTTP {approve_response.status_code if approve_response else 'No response'}")
                        else:
                            self.log_result("Get Trip Requests", False, "Response is not a list", data)
                    except json.JSONDecodeError:
                        self.log_result("Get Trip Requests", False, "Invalid JSON response", {"response": response.text})
                else:
                    self.log_result("Get Trip Requests", False, f"HTTP {response.status_code if response else 'No response'}")
            else:
                try:
                    error_data = response.json()
                    self.log_result("Join Trip Request", False, f"HTTP {response.status_code}", error_data)
                except:
                    self.log_result("Join Trip Request", False, f"HTTP {response.status_code}", {"response": response.text})
    
    def test_wallet_balance(self):
        """Test wallet balance endpoint"""
        print("\n=== Testing Wallet & Referrals ===")
        
        if not self.tokens:
            self.log_result("Wallet Balance", False, "No authentication tokens available")
            return
        
        token = list(self.tokens.values())[0]
        headers = {"Authorization": f"Bearer {token}"}
        
        response = self.make_request("GET", "/wallet/balance", headers=headers)
        
        if response is None:
            self.log_result("Wallet Balance", False, "Request failed - connection error")
        elif response.status_code == 200:
            try:
                data = response.json()
                if "balance" in data and "reward_points" in data:
                    self.log_result("Wallet Balance", True, f"Balance: {data['balance']}, Reward Points: {data['reward_points']}")
                else:
                    self.log_result("Wallet Balance", False, "Missing balance or reward_points", data)
            except json.JSONDecodeError:
                self.log_result("Wallet Balance", False, "Invalid JSON response", {"response": response.text})
        else:
            try:
                error_data = response.json()
                self.log_result("Wallet Balance", False, f"HTTP {response.status_code}", error_data)
            except:
                self.log_result("Wallet Balance", False, f"HTTP {response.status_code}", {"response": response.text})
    
    def test_referral_code(self):
        """Test referral code endpoint"""
        if not self.tokens:
            self.log_result("Referral Code", False, "No authentication tokens available")
            return
        
        token = list(self.tokens.values())[0]
        headers = {"Authorization": f"Bearer {token}"}
        
        response = self.make_request("GET", "/referral/code", headers=headers)
        
        if response is None:
            self.log_result("Referral Code", False, "Request failed - connection error")
        elif response.status_code == 200:
            try:
                data = response.json()
                if "referral_code" in data and "successful_referrals" in data:
                    self.log_result("Referral Code", True, f"Referral Code: {data['referral_code']}, Successful: {data['successful_referrals']}")
                else:
                    self.log_result("Referral Code", False, "Missing referral_code or successful_referrals", data)
            except json.JSONDecodeError:
                self.log_result("Referral Code", False, "Invalid JSON response", {"response": response.text})
        else:
            try:
                error_data = response.json()
                self.log_result("Referral Code", False, f"HTTP {response.status_code}", error_data)
            except:
                self.log_result("Referral Code", False, f"HTTP {response.status_code}", {"response": response.text})
    
    def test_conversations(self):
        """Test conversations endpoint"""
        print("\n=== Testing Conversations ===")
        
        if not self.tokens:
            self.log_result("Conversations", False, "No authentication tokens available")
            return
        
        token = list(self.tokens.values())[0]
        headers = {"Authorization": f"Bearer {token}"}
        
        response = self.make_request("GET", "/conversations", headers=headers)
        
        if response is None:
            self.log_result("Conversations", False, "Request failed - connection error")
        elif response.status_code == 200:
            try:
                data = response.json()
                if isinstance(data, list):
                    self.log_result("Conversations", True, f"Retrieved {len(data)} conversations")
                else:
                    self.log_result("Conversations", False, "Response is not a list", data)
            except json.JSONDecodeError:
                self.log_result("Conversations", False, "Invalid JSON response", {"response": response.text})
        else:
            try:
                error_data = response.json()
                self.log_result("Conversations", False, f"HTTP {response.status_code}", error_data)
            except:
                self.log_result("Conversations", False, f"HTTP {response.status_code}", {"response": response.text})
    
    def test_error_cases(self):
        """Test error handling"""
        print("\n=== Testing Error Cases ===")
        
        # Test unauthorized access
        try:
            response = self.make_request("GET", "/auth/me")
            if response is not None:
                if response.status_code == 401:
                    self.log_result("Unauthorized Access", True, "Correctly returns 401 for missing auth")
                else:
                    self.log_result("Unauthorized Access", False, f"Expected 401, got {response.status_code}")
            else:
                # Try direct curl as fallback
                import subprocess
                result = subprocess.run(
                    ['curl', '-s', '-w', '\\n%{http_code}', f'{BASE_URL}/auth/me'],
                    capture_output=True, text=True, timeout=5
                )
                status_code = result.stdout.strip().split('\\n')[-1]
                if status_code == '401':
                    self.log_result("Unauthorized Access", True, "Correctly returns 401 for missing auth (via curl)")
                else:
                    self.log_result("Unauthorized Access", False, f"Expected 401, got {status_code} (via curl)")
        except Exception as e:
            self.log_result("Unauthorized Access", False, f"Exception: {str(e)}")
        
        # Test invalid token
        try:
            headers = {"Authorization": "Bearer invalid_token"}
            response = self.make_request("GET", "/auth/me", headers=headers)
            if response is not None:
                if response.status_code == 401:
                    self.log_result("Invalid Token", True, "Correctly returns 401 for invalid token")
                else:
                    self.log_result("Invalid Token", False, f"Expected 401, got {response.status_code}")
            else:
                # Try direct curl as fallback
                import subprocess
                result = subprocess.run(
                    ['curl', '-s', '-w', '\\n%{http_code}', '-H', 'Authorization: Bearer invalid_token', f'{BASE_URL}/auth/me'],
                    capture_output=True, text=True, timeout=5
                )
                status_code = result.stdout.strip().split('\\n')[-1]
                if status_code == '401':
                    self.log_result("Invalid Token", True, "Correctly returns 401 for invalid token (via curl)")
                else:
                    self.log_result("Invalid Token", False, f"Expected 401, got {status_code} (via curl)")
        except Exception as e:
            self.log_result("Invalid Token", False, f"Exception: {str(e)}")
        
        # Test invalid signup data
        try:
            invalid_data = {"email": "invalid-email", "password": "123"}
            response = self.make_request("POST", "/auth/signup", invalid_data)
            if response is not None:
                if response.status_code in [400, 422]:
                    self.log_result("Invalid Signup Data", True, f"Correctly returns {response.status_code} for invalid data")
                else:
                    self.log_result("Invalid Signup Data", False, f"Expected 400/422, got {response.status_code}")
            else:
                # Try direct curl as fallback
                import subprocess
                result = subprocess.run(
                    ['curl', '-s', '-w', '\\n%{http_code}', '-X', 'POST', '-H', 'Content-Type: application/json',
                     '-d', '{"email":"invalid"}', f'{BASE_URL}/auth/signup'],
                    capture_output=True, text=True, timeout=5
                )
                status_code = result.stdout.strip().split('\\n')[-1]
                if status_code in ['400', '422']:
                    self.log_result("Invalid Signup Data", True, f"Correctly returns {status_code} for invalid data (via curl)")
                else:
                    self.log_result("Invalid Signup Data", False, f"Expected 400/422, got {status_code} (via curl)")
        except Exception as e:
            self.log_result("Invalid Signup Data", False, f"Exception: {str(e)}")
    
    def run_all_tests(self):
        """Run all tests"""
        print("🚀 Starting Aventaro Backend API Tests")
        print(f"📍 Testing against: {BASE_URL}")
        print("=" * 60)
        
        # Run tests in order
        self.test_auth_signup()
        self.test_auth_signin()
        self.test_auth_me()
        self.test_discover_users()
        self.test_discover_trips()
        self.test_friend_requests()
        self.test_trip_operations()
        self.test_wallet_balance()
        self.test_referral_code()
        self.test_conversations()
        self.test_error_cases()
        
        # Summary
        print("\n" + "=" * 60)
        print("📊 TEST SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for r in self.test_results if "✅ PASS" in r["status"])
        failed = sum(1 for r in self.test_results if "❌ FAIL" in r["status"])
        total = len(self.test_results)
        
        print(f"Total Tests: {total}")
        print(f"✅ Passed: {passed}")
        print(f"❌ Failed: {failed}")
        print(f"Success Rate: {(passed/total*100):.1f}%" if total > 0 else "0%")
        
        if failed > 0:
            print("\n🔍 FAILED TESTS:")
            for result in self.test_results:
                if "❌ FAIL" in result["status"]:
                    print(f"  • {result['test']}: {result['message']}")
        
        print("\n" + "=" * 60)
        return failed == 0

if __name__ == "__main__":
    tester = AventaroAPITester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)